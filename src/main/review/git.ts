import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findHunk, hunksOf, splitLines, stageHunk, unstageHunk, discardHunk, type Hunk } from '../../common/hunks'
import type { ChangedFile, ChangeSpec, Changeset, FileChange, FileTexts, Worktree } from '../../common/review'
import { writeFileWhileBusy } from '../busy'
import { GitError } from '../git'
import type { Checkpoint } from './store'

/**
 * The review's git (ADR-006, R1): the system's git, which knows worktrees,
 * ranges and the index as it is — isomorphic-git knows none of them well.
 * Arguments go as a list (no shell); paths are `/`-separated from the root.
 */

/** A file larger than this is listed but not read. */
export const MAX_TEXT = 4 << 20

interface RunOptions {
  input?: string | Buffer
}

export class ReviewGit {
  constructor(readonly bin: string) {}

  run(cwd: string, args: string[], o: RunOptions = {}): Promise<string> {
    return this.exec(cwd, args, o).then((b) => b.toString('utf8'))
  }

  exec(cwd: string, args: string[], o: RunOptions = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.bin,
        ['-c', 'core.quotepath=false', '--no-pager', ...args],
        {
          cwd,
          timeout: 60_000,
          windowsHide: true,
          encoding: 'buffer',
          maxBuffer: 64 << 20,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
        },
        (error, stdout, stderr) => (error ? reject(new GitError('failed', [stderr.toString('utf8').trim() || error.message])) : resolve(stdout)),
      )
      if (o.input !== undefined) child.stdin?.end(o.input)
    })
  }

  /** The tree with nothing in it, by the repository's own hash. */
  private emptyTrees = new Map<string, string>()
  async emptyTree(cwd: string): Promise<string> {
    let t = this.emptyTrees.get(cwd)
    if (!t) {
      t = (await this.run(cwd, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })).trim()
      this.emptyTrees.set(cwd, t)
    }
    return t
  }

  /** A revision's commit, or null (an unborn branch, a name that is none). */
  async resolve(cwd: string, rev: string): Promise<string | null> {
    try {
      return (await this.run(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])).trim() || null
    } catch {
      return null
    }
  }

  // Sets of changes ----------------------------------------------------------

  /** What a set compares: a revision and a revision, or a revision and the disk. */
  async sidesOf(spec: Exclude<ChangeSpec, { kind: 'since' }>): Promise<{ root: string; before: string; after: string | 'disk' }> {
    switch (spec.kind) {
      case 'working': {
        const head = await this.resolve(spec.repo, 'HEAD')
        return { root: spec.repo, before: head ?? (await this.emptyTree(spec.repo)), after: 'disk' }
      }
      case 'commit': {
        const parent = await this.resolve(spec.repo, `${spec.oid}^1`)
        return { root: spec.repo, before: parent ?? (await this.emptyTree(spec.repo)), after: spec.oid }
      }
      case 'range': {
        const base = await this.mergeBase(spec.repo, spec.from, spec.to)
        return { root: spec.repo, before: base ?? (await this.emptyTree(spec.repo)), after: spec.to }
      }
      case 'worktree': {
        const base = await this.mergeBase(spec.path, spec.base, 'HEAD')
        return { root: spec.path, before: base ?? (await this.emptyTree(spec.path)), after: 'disk' }
      }
    }
  }

  async mergeBase(cwd: string, a: string, b: string): Promise<string | null> {
    try {
      return (await this.run(cwd, ['merge-base', a, b])).trim() || null
    } catch {
      return null
    }
  }

  /** The files of a set: what git says changed, and, against the disk, the files it does not know yet. */
  async changeset(spec: Exclude<ChangeSpec, { kind: 'since' }>): Promise<Changeset> {
    const { root, before, after } = await this.sidesOf(spec)
    const range = after === 'disk' ? [before] : [before, after]
    const [numstat, names] = await Promise.all([
      this.run(root, ['diff', '--no-color', '--no-ext-diff', '-M', '--numstat', '-z', ...range, '--']),
      this.run(root, ['diff', '--no-color', '--no-ext-diff', '-M', '--name-status', '-z', ...range, '--']),
    ])
    const files = mergeStats(parseNameStatus(names), parseNumstat(numstat))
    if (after === 'disk') {
      const others = (await this.run(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
      for (const path of others) files.push({ path, status: 'added', untracked: true, ...countLines(join(root, path)) })
    }
    files.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
    if (after === 'disk') for (const f of files) f.mtime = mtimeOf(join(root, ...f.path.split('/')))
    const subject = spec.kind === 'commit' ? (await this.run(root, ['log', '-1', '--format=%s', spec.oid]).catch(() => '')).trim() : ''
    return { spec, root, before, after, files, ...(subject ? { subject } : {}) }
  }

  /** A file's text in a revision (`:` the index), or null when it is not there. */
  async textAt(root: string, rev: string, path: string): Promise<string | null> {
    try {
      const out = await this.exec(root, ['cat-file', 'blob', `${rev}:${path}`])
      return out.toString('utf8')
    } catch {
      return null
    }
  }

  /** A file's two texts in a set (and the index's, for the working copy). */
  async texts(set: Pick<Changeset, 'spec' | 'root' | 'before' | 'after'>, file: Pick<ChangedFile, 'path' | 'oldPath' | 'status' | 'binary'>): Promise<FileTexts> {
    if (file.binary) return { before: null, after: null, binary: true }
    const disk = join(set.root, ...file.path.split('/'))
    if (set.after === 'disk' && existsSync(disk) && statSync(disk).size > MAX_TEXT) return { before: null, after: null, tooBig: true }
    const before = file.status === 'added' ? null : await this.textAt(set.root, set.before, file.oldPath ?? file.path)
    const after = file.status === 'deleted' ? null : set.after === 'disk' ? readText(disk) : await this.textAt(set.root, set.after, file.path)
    if ((before?.length ?? 0) > MAX_TEXT || (after?.length ?? 0) > MAX_TEXT) return { before: null, after: null, tooBig: true }
    if ((before !== null && before.includes('\0')) || (after !== null && after.includes('\0'))) return { before: null, after: null, binary: true }
    const index = set.spec.kind === 'working' ? await this.textAt(set.root, '', file.path) : undefined
    return { before, after, ...(index !== undefined ? { index } : {}) }
  }

  // Since the last look (R3) -------------------------------------------------

  /** What is seen now: the commit, and the text of every file that differs from it. */
  async snapshot(repo: string, only?: string[]): Promise<Checkpoint> {
    const head = await this.resolve(repo, 'HEAD')
    const set = await this.changeset({ kind: 'working', repo })
    const files: Record<string, string | null> = {}
    for (const f of set.files) {
      if (only && !only.includes(f.path)) continue
      if (f.binary) continue
      files[f.path] = f.status === 'deleted' ? null : readText(join(repo, ...f.path.split('/')))
    }
    return { head, time: Date.now(), files }
  }

  /** A file as it was seen: its text in the checkpoint, else in the commit then. */
  private async seen(repo: string, cp: Checkpoint, path: string): Promise<string | null> {
    if (path in cp.files) return cp.files[path] ?? null
    return cp.head ? this.textAt(repo, cp.head, path) : null
  }

  /**
   * What changed since the checkpoint: every file that differs now from how it
   * was seen — edited, made, deleted, committed meanwhile (an agent commits too).
   */
  async since(repo: string, cp: Checkpoint | null): Promise<Changeset> {
    const spec = { kind: 'since' as const, repo }
    const head = await this.resolve(repo, 'HEAD')
    const point: Checkpoint = cp ?? { head, time: 0, files: {} }
    const now = await this.changeset({ kind: 'working', repo })
    const paths = new Set<string>([...now.files.map((f) => f.path), ...Object.keys(point.files)])
    if (point.head && head && point.head !== head) {
      const committed = await this.run(repo, ['diff', '--name-only', '-z', '--no-renames', point.head, head, '--']).catch(() => '')
      for (const p of committed.split('\0').filter(Boolean)) paths.add(p)
    }
    const files: ChangedFile[] = []
    for (const path of paths) {
      const disk = join(repo, ...path.split('/'))
      const before = await this.seen(repo, point, path)
      const after = readText(disk)
      if (before === after) continue
      const binary = (before ?? '').includes('\0') || (after ?? '').includes('\0')
      let add = 0
      let del = 0
      if (!binary && (before?.length ?? 0) <= MAX_TEXT && (after?.length ?? 0) <= MAX_TEXT) {
        for (const h of hunksOf(splitLines(before ?? ''), splitLines(after ?? ''))) {
          add += h.bEnd - h.b
          del += h.aEnd - h.a
        }
      }
      files.push({ path, status: before === null ? 'added' : after === null ? 'deleted' : 'modified', binary, add, del, mtime: mtimeOf(disk) })
    }
    // The newest first: what the agent just did on top.
    files.sort((x, y) => (y.mtime ?? 0) - (x.mtime ?? 0) || (x.path < y.path ? -1 : 1))
    return { spec, root: repo, before: 'checkpoint', after: 'disk', files }
  }

  /** A file's texts since the checkpoint. */
  async sinceTexts(repo: string, cp: Checkpoint | null, path: string): Promise<FileTexts> {
    const point: Checkpoint = cp ?? { head: await this.resolve(repo, 'HEAD'), time: 0, files: {} }
    const before = await this.seen(repo, point, path)
    const after = readText(join(repo, ...path.split('/')))
    if ((before?.length ?? 0) > MAX_TEXT || (after?.length ?? 0) > MAX_TEXT) return { before: null, after: null, tooBig: true }
    if ((before ?? '').includes('\0') || (after ?? '').includes('\0')) return { before: null, after: null, binary: true }
    return { before, after }
  }

  // The working copy's actions -------------------------------------------------

  /**
   * A file of the working copy staged, taken out of the index or thrown away —
   * whole, or one run of it (HEAD → disk) checked against the texts as they
   * are now: a run that changed meanwhile is refused (`stale`).
   */
  async act(repo: string, action: 'stage' | 'unstage' | 'discard', path: string, hunk: (Hunk & { lines?: { before: string[]; after: string[] } }) | null): Promise<void> {
    const disk = join(repo, ...path.split('/'))
    const headRev = await this.resolve(repo, 'HEAD')
    const head = headRev ? await this.textAt(repo, headRev, path) : null
    if (!hunk) {
      if (action === 'stage') await this.run(repo, ['add', '-A', '--', path])
      else if (action === 'unstage') await this.run(repo, headRev ? ['reset', '-q', 'HEAD', '--', path] : ['rm', '--cached', '-q', '--', path])
      else if (head === null) {
        // New to git: out of the index; the file itself is the caller's (to the trash).
        await this.run(repo, ['rm', '--cached', '-q', '--ignore-unmatch', '--', path])
      } else await this.run(repo, ['checkout', headRev!, '--', path])
      return
    }
    const working = readText(disk) ?? ''
    const index = (await this.textAt(repo, '', path)) ?? ''
    const base = head ?? ''
    const run = findHunk(base, working, hunk)
    if (!run) throw new GitError('stale')
    if (action === 'stage') await this.writeIndex(repo, path, stageHunk(index, working, run))
    else if (action === 'unstage') await this.writeIndex(repo, path, unstageHunk(base, index, run))
    else writeFileWhileBusy(disk, discardHunk(base, working, run))
  }

  /** The index's entry of a file set to a text (its mode kept, or the file's). */
  private async writeIndex(repo: string, path: string, text: string): Promise<void> {
    const sha = (await this.run(repo, ['hash-object', '-w', '--no-filters', '--stdin'], { input: text })).trim()
    const listed = (await this.run(repo, ['ls-files', '-s', '-z', '--', path])).split(' ')[0]
    let mode = listed && /^\d{6}$/.test(listed) ? listed : '100644'
    if (!listed) {
      try {
        if (statSync(join(repo, ...path.split('/'))).mode & 0o111) mode = '100755'
      } catch {
        // Gone from the disk: an ordinary file.
      }
    }
    await this.run(repo, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${path}`])
  }

  // Worktrees ----------------------------------------------------------------

  /** The repository's working copies: the main one first, then each worktree, with where it stands against `base`. */
  async worktrees(repo: string, base: string | null): Promise<Worktree[]> {
    const listed = parseWorktrees(await this.run(repo, ['worktree', 'list', '--porcelain']))
    return Promise.all(
      listed.map(async (w, i) => {
        const out: Worktree = { ...w, main: i === 0, changed: 0, ahead: 0, behind: 0, lastActivity: 0 }
        if (w.prunable || !existsSync(w.path)) return out
        try {
          const status = (await this.run(w.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0').filter((x) => /^.. /.test(x))
          out.changed = status.length
          let newest = Number((await this.run(w.path, ['log', '-1', '--format=%ct']).catch(() => '0')).trim() || 0) * 1000
          for (const line of status.slice(0, 500)) {
            try {
              newest = Math.max(newest, statSync(join(w.path, ...line.slice(3).split('/'))).mtimeMs)
            } catch {
              // Deleted: no time of its own.
            }
          }
          out.lastActivity = Math.round(newest)
          if (base && w.head) {
            const [behind = '0', ahead = '0'] = (await this.run(w.path, ['rev-list', '--left-right', '--count', `${base}...HEAD`]).catch(() => '0\t0')).trim().split(/\s+/)
            out.ahead = Number(ahead)
            out.behind = Number(behind)
          }
        } catch {
          // A worktree git cannot read now: listed without counts.
        }
        return out
      }),
    )
  }

  /** The branch of the main working copy: the base worktrees are measured against. */
  async currentBranch(repo: string): Promise<string | null> {
    try {
      return (await this.run(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || null
    } catch {
      return null
    }
  }

  /** A worktree removed (`force`: with its changes); its branch deleted too when asked. */
  async removeWorktree(repo: string, path: string, force: boolean, branch: string | null): Promise<void> {
    await this.run(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
    if (branch) await this.run(repo, ['branch', '-D', branch])
  }

  /** A worktree's branch merged into the main copy's current branch (a merge commit always). */
  async mergeBranch(repo: string, branch: string): Promise<void> {
    try {
      await this.run(repo, ['merge', '--no-ff', '--no-edit', branch])
    } catch (e) {
      if (existsSync(join(repo, '.git', 'MERGE_HEAD'))) throw new GitError('conflict', (e as GitError).detail)
      throw e
    }
  }

  /**
   * A worktree's changes against the base — committed and not, new files too —
   * brought into the main copy's working files without a commit (a 3-way
   * apply: clashes are left marked).
   */
  async takeChanges(repo: string, worktree: string, base: string): Promise<void> {
    const mb = (await this.mergeBase(worktree, base, 'HEAD')) ?? (await this.emptyTree(worktree))
    const tracked = await this.exec(worktree, ['diff', '--binary', '--no-color', '--no-ext-diff', mb, '--'])
    const others = (await this.run(worktree, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
    // New files of the worktree: copied as they are, never over a file of the same name.
    for (const path of others) {
      if (existsSync(join(repo, ...path.split('/')))) throw new GitError('exists', [path])
    }
    if (tracked.length) {
      try {
        await this.run(repo, ['apply', '--3way', '--whitespace=nowarn'], { input: tracked })
      } catch (e) {
        throw new GitError('conflict', (e as GitError).detail)
      }
    }
    for (const path of others) writeFileWhileBusy(join(repo, ...path.split('/')), readFileSync(join(worktree, ...path.split('/'))))
  }
}

function mtimeOf(path: string): number | undefined {
  try {
    return Math.round(statSync(path).mtimeMs)
  } catch {
    return undefined
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** A file's lines (a binary one: none), as git counts them for a new file. */
function countLines(path: string): Pick<ChangedFile, 'add' | 'del' | 'binary'> {
  try {
    const st = statSync(path)
    if (st.size > MAX_TEXT) return { add: 0, del: 0, binary: false }
    const buf = readFileSync(path)
    if (buf.subarray(0, 8000).includes(0)) return { add: 0, del: 0, binary: true }
    const text = buf.toString('utf8')
    return { add: text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0), del: 0, binary: false }
  } catch {
    return { add: 0, del: 0, binary: false }
  }
}

const STATUS: Record<string, FileChange> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechange' }

/** `--name-status -z`: a letter (with a score for R and C), then one path or two. */
export function parseNameStatus(out: string): { path: string; oldPath?: string; status: FileChange }[] {
  const parts = out.split('\0')
  const files: { path: string; oldPath?: string; status: FileChange }[] = []
  for (let i = 0; i < parts.length - 1; ) {
    const letter = parts[i++]!.charAt(0)
    if (!letter) continue
    const status = STATUS[letter] ?? 'modified'
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[i++]!
      files.push({ path: parts[i++]!, oldPath, status })
    } else files.push({ path: parts[i++]!, status })
  }
  return files
}

/** `--numstat -z`: added, removed (`-` for binary), and a path — or, renamed, an empty one and two paths. */
export function parseNumstat(out: string): Map<string, { add: number; del: number; binary: boolean }> {
  const parts = out.split('\0')
  const stats = new Map<string, { add: number; del: number; binary: boolean }>()
  for (let i = 0; i < parts.length - 1; ) {
    const head = parts[i++]!
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(head)
    if (!m) continue
    let path = m[3]!
    if (path === '') {
      i++
      path = parts[i++]!
    }
    const binary = m[1] === '-'
    stats.set(path, { add: binary ? 0 : Number(m[1]), del: binary ? 0 : Number(m[2]), binary })
  }
  return stats
}

function mergeStats(names: ReturnType<typeof parseNameStatus>, stats: ReturnType<typeof parseNumstat>): ChangedFile[] {
  return names.map((f) => ({ ...f, ...(stats.get(f.path) ?? { add: 0, del: 0, binary: false }) }))
}

/** `worktree list --porcelain`: blocks of `key value` lines, a blank line between. */
export function parseWorktrees(out: string): Omit<Worktree, 'main' | 'changed' | 'ahead' | 'behind' | 'lastActivity'>[] {
  const list: Omit<Worktree, 'main' | 'changed' | 'ahead' | 'behind' | 'lastActivity'>[] = []
  for (const block of out.split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean)
    const path = lines.find((l) => l.startsWith('worktree '))?.slice(9)
    if (!path || lines.includes('bare')) continue
    const branch = lines.find((l) => l.startsWith('branch '))?.slice(7) ?? null
    list.push({
      path,
      head: lines.find((l) => l.startsWith('HEAD '))?.slice(5) ?? null,
      branch: branch ? branch.replace(/^refs\/heads\//, '') : null,
      locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      prunable: lines.some((l) => l === 'prunable' || l.startsWith('prunable ')),
    })
  }
  return list
}
