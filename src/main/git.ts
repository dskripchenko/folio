import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import git from 'isomorphic-git'

/**
 * History with git (ADR-001, stage 4), through isomorphic-git: it works on a
 * machine without git installed. Paths given are absolute; git's own are
 * `/`-separated and relative to the repository's root.
 */
export interface Author {
  name: string
  email: string
}

export interface Version {
  oid: string
  message: string
  author: string
  email: string
  /** Seconds since the epoch. */
  time: number
}

export type FileStatus = 'new' | 'modified' | 'deleted' | 'clean'

const toGit = (root: string, path: string) => relative(root, path).split(sep).join('/')

/** The repository holding a path (looked for upwards), or null. */
export async function repoOf(path: string): Promise<string | null> {
  try {
    return await git.findRoot({ fs, filepath: path })
  } catch {
    return null
  }
}

export async function branchOf(root: string): Promise<string | null> {
  try {
    return (await git.currentBranch({ fs, dir: root, fullname: false })) ?? null
  } catch {
    return null
  }
}

/** `[user] name = …` of an ini-like git config; undefined when absent. */
export function userFromConfig(text: string): Partial<Author> {
  const out: Partial<Author> = {}
  let inUser = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inUser = /^\[user\]$/i.test(line)
      continue
    }
    const m = inUser ? /^(name|email)\s*=\s*(.*)$/i.exec(line) : null
    if (m) out[m[1]!.toLowerCase() as keyof Author] = m[2]!.replace(/^"(.*)"$/, '$1')
  }
  return out
}

/** Who commits: the repository's config, then the user's `~/.gitconfig`, then the fallback. */
export function authorOf(root: string, fallback: Author, home = homedir()): Author {
  const read = (file: string) => {
    try {
      return userFromConfig(fs.readFileSync(file, 'utf8'))
    } catch {
      return {}
    }
  }
  const repo = read(join(root, '.git', 'config'))
  const user = { ...read(join(home, '.config', 'git', 'config')), ...read(join(home, '.gitconfig')) }
  return { name: repo.name ?? user.name ?? fallback.name, email: repo.email ?? user.email ?? fallback.email }
}

/**
 * Start a history in a folder: a repository (branch `main`) and a first
 * commit of what is there, `.gitignore` respected.
 */
export async function startHistory(dir: string, author: Author, message: string): Promise<void> {
  await git.init({ fs, dir, defaultBranch: 'main' })
  const matrix = await git.statusMatrix({ fs, dir })
  for (const [filepath] of matrix) await git.add({ fs, dir, filepath })
  await git.commit({ fs, dir, message, author })
}

/**
 * Commit one file as it is on disk (added, changed or removed); null when
 * nothing changed. Compared by content, not by git's stat cache: a save in
 * the same second as the last commit, of the same size, must still count.
 */
export async function commitFile(root: string, path: string, message: string, author: Author): Promise<string | null> {
  const filepath = toGit(root, path)
  const exists = fs.existsSync(path)
  let committed: string | null
  try {
    const head = await git.resolveRef({ fs, dir: root, ref: 'HEAD' })
    committed = (await git.readBlob({ fs, dir: root, oid: head, filepath })).oid
  } catch {
    committed = null
  }
  if (exists) {
    const { oid } = await git.hashBlob({ object: fs.readFileSync(path) })
    if (oid === committed) return null
    await git.add({ fs, dir: root, filepath })
  } else {
    if (committed === null) return null
    await git.remove({ fs, dir: root, filepath })
  }
  return git.commit({ fs, dir: root, message, author })
}

/** The versions of a file, newest first. */
export async function historyOf(root: string, path: string, depth = 200): Promise<Version[]> {
  try {
    const log = await git.log({ fs, dir: root, filepath: toGit(root, path), depth, force: true })
    return log.map((e) => ({
      oid: e.oid,
      message: e.commit.message.trim(),
      author: e.commit.author.name,
      email: e.commit.author.email,
      time: e.commit.author.timestamp,
    }))
  } catch {
    // No commit yet, or the file was never committed.
    return []
  }
}

/** A file's text as a commit has it; null when it was not there. */
export async function textAt(root: string, path: string, oid: string): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir: root, oid, filepath: toGit(root, path) })
    return new TextDecoder().decode(blob)
  } catch {
    return null
  }
}

/** The status of the files under a folder of the repository, by their absolute paths. */
export async function statusUnder(root: string, dir: string): Promise<Map<string, FileStatus>> {
  const prefix = toGit(root, dir)
  const out = new Map<string, FileStatus>()
  let matrix: [string, number, number, number][]
  try {
    matrix = await git.statusMatrix({ fs, dir: root, filepaths: prefix === '' ? undefined : [prefix] })
  } catch {
    return out
  }
  for (const [filepath, head, workdir] of matrix) {
    const status: FileStatus = head === 0 ? 'new' : workdir === 0 ? 'deleted' : head !== workdir ? 'modified' : 'clean'
    if (status !== 'clean') out.set(join(root, ...filepath.split('/')), status)
  }
  return out
}
