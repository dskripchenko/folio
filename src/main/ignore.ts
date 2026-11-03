import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

/**
 * What git leaves out of a repository — `.gitignore` in every folder,
 * `.git/info/exclude` and the user's global excludes file — read as git
 * reads it (ADR-002, I1): the tree, going to a file, searching and the
 * watcher follow it in a folder under git; a folder without git keeps
 * folio's own lists of tooling folders.
 *
 * The rules: a later line wins over an earlier one and a deeper file over a
 * higher one; `!` takes a path back, but not out of a folder that is left
 * out; a trailing `/` is for folders only; a pattern with a slash before its
 * end is anchored to its file's folder, one without matches a name at any
 * depth; `*` and `?` stay within a path part, `**` crosses parts.
 */

interface Rule {
  /** The folder of the file the rule is in, from the repository's root (`''`: the root). */
  base: string
  re: RegExp
  negate: boolean
  dirOnly: boolean
  /** Matched against the whole path below `base`, not the last part alone. */
  anchored: boolean
}

/** A glob of `.gitignore` as a regular expression (the whole string). */
export function globSource(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!
    if (ch === '\\' && i + 1 < glob.length) {
      out += glob[++i]!.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    } else if (ch === '*') {
      if (glob[i + 1] === '*') {
        const before = i === 0 || glob[i - 1] === '/'
        const after = glob[i + 2] === '/' || i + 2 === glob.length
        if (before && after) {
          i++
          if (glob[i + 1] === '/') {
            i++
            out += '(?:.*/)?'
          } else out += '.*'
          continue
        }
      }
      out += '[^/]*'
    } else if (ch === '?') out += '[^/]'
    else if (ch === '[') {
      const end = glob.indexOf(']', i + 2)
      if (end < 0) out += '\\['
      else {
        let body = glob.slice(i + 1, end)
        if (body.startsWith('!')) body = '^' + body.slice(1)
        out += `[${body.replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else out += ch.replace(/[.+^${}()|\\/]/g, '\\$&')
  }
  return out
}

/** The rules of one ignore file's text, for a folder of the repository. */
export function parseIgnore(text: string, base: string): Rule[] {
  const rules: Rule[] = []
  for (let line of text.split(/\r?\n/)) {
    // Trailing spaces go, unless escaped.
    line = line.replace(/(?<!\\)\s+$/, '')
    if (line === '' || line.startsWith('#')) continue
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1)
    let dirOnly = false
    if (line.endsWith('/')) {
      dirOnly = true
      line = line.slice(0, -1)
    }
    if (line === '') continue
    const anchored = line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    rules.push({ base, re: new RegExp(`^${globSource(line)}$`), negate, dirOnly, anchored })
  }
  return rules
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The user's global excludes file: `core.excludesFile` in `~/.gitconfig`, else `~/.config/git/ignore`. */
export function globalExcludesFile(home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  const config = readText(join(home, '.gitconfig')) ?? ''
  let section = ''
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim()
    const head = /^\[([^\]]+)\]/.exec(line)
    if (head) {
      section = head[1]!.trim().toLowerCase()
      continue
    }
    const kv = /^excludesfile\s*=\s*(.+)$/i.exec(line)
    if (section === 'core' && kv) {
      const value = kv[1]!.trim().replace(/^"(.*)"$/, '$1')
      return value.startsWith('~') ? join(home, value.slice(1)) : value
    }
  }
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'git', 'ignore')
}

/** One repository's rules, each folder's file read once (until `forget`). */
export class Ignore {
  private readonly perDir = new Map<string, Rule[]>()
  private readonly top: Rule[]
  private readonly verdicts = new Map<string, boolean>()

  constructor(
    readonly root: string,
    globalFile: string | null = globalExcludesFile(),
  ) {
    this.top = [
      ...(globalFile ? parseIgnore(readText(globalFile) ?? '', '') : []),
      ...parseIgnore(readText(join(root, '.git', 'info', 'exclude')) ?? '', ''),
    ]
  }

  /** Whether a path of the repository (`/`-separated, from its root) is left out. */
  ignored(path: string, isDir: boolean): boolean {
    const key = `${path}${isDir ? '/' : ''}`
    const known = this.verdicts.get(key)
    if (known !== undefined) return known
    const parts = path.split('/').filter((p) => p !== '')
    // A folder left out leaves out all of it: nothing below is taken back.
    const out = (parts.length > 1 && this.ignored(parts.slice(0, -1).join('/'), true)) || this.decide(parts, isDir)
    if (this.verdicts.size > 50_000) this.verdicts.clear()
    this.verdicts.set(key, out)
    return out
  }

  /** The rules changed (a `.gitignore` written): read again. */
  forget(): void {
    this.perDir.clear()
    this.verdicts.clear()
  }

  private decide(parts: string[], isDir: boolean): boolean {
    const rules = [...this.top]
    for (let i = 0; i < parts.length; i++) rules.push(...this.rulesOf(parts.slice(0, i).join('/')))
    const name = parts[parts.length - 1] ?? ''
    const whole = parts.join('/')
    let out = false
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue
      let target: string
      if (rule.base === '') target = whole
      else if (whole.startsWith(rule.base + '/')) target = whole.slice(rule.base.length + 1)
      else continue
      if (rule.anchored ? rule.re.test(target) : rule.re.test(name)) out = !rule.negate
    }
    return out
  }

  private rulesOf(dir: string): Rule[] {
    let rules = this.perDir.get(dir)
    if (!rules) {
      rules = parseIgnore(readText(join(this.root, ...dir.split('/').filter(Boolean), '.gitignore')) ?? '', dir)
      this.perDir.set(dir, rules)
    }
    return rules
  }
}

/** The repository a folder is in (its root holds `.git`, a folder or a worktree's file); null outside git. */
export function repositoryOf(dir: string): string | null {
  let current = dir
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(current, '.git'))) return current
    const up = dirname(current)
    if (up === current) return null
    current = up
  }
  return null
}

/** Ignore rules by repository, shared by everything that walks folders. */
export class Ignores {
  private readonly byRepo = new Map<string, Ignore>()
  private readonly repoOfDir = new Map<string, string | null>()

  /** The repository of a folder and its rules; null outside git. */
  of(dir: string): Ignore | null {
    let repo = this.repoOfDir.get(dir)
    if (repo === undefined) {
      repo = repositoryOf(dir)
      this.repoOfDir.set(dir, repo)
    }
    if (repo === null) return null
    let ignore = this.byRepo.get(repo)
    if (!ignore) {
      ignore = new Ignore(repo)
      this.byRepo.set(repo, ignore)
    }
    return ignore
  }

  /** Whether a file or folder (absolute) is left out by the git it is under. */
  ignored(path: string, isDir: boolean): boolean {
    const ignore = this.of(isDir ? dirname(path) : dirname(path))
    if (!ignore) return false
    const rel = relative(ignore.root, path).split(sep).join('/')
    if (rel === '' || rel.startsWith('..')) return false
    return ignore.ignored(rel, isDir)
  }

  /** Files changed on disk: a changed `.gitignore` (or exclude) means its repository's rules are read again. */
  changed(files: readonly string[]): boolean {
    let any = false
    for (const f of files) {
      const name = f.split(/[\\/]/).pop()
      if (name !== '.gitignore' && !f.endsWith(join('info', 'exclude'))) continue
      const ignore = this.of(dirname(f))
      if (ignore) {
        ignore.forget()
        any = true
      }
    }
    return any
  }

  /** A repository started or removed under a folder: found again. */
  reset(): void {
    this.byRepo.clear()
    this.repoOfDir.clear()
  }
}

