import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
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
    const root = await git.findRoot({ fs, filepath: path })
    // On Windows a folder outside any repository may come back as `.`: only a real one counts.
    return isAbsolute(root) && fs.existsSync(join(root, '.git')) ? root : null
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
    // In the order of the history itself, newest first: two commits in one second keep their order.
    const walk = await git.log({ fs, dir: root, depth: Math.max(depth * 5, 1000) })
    const at = new Map(walk.map((e, i) => [e.oid, i]))
    log.sort((a, b) => (at.get(a.oid) ?? Infinity) - (at.get(b.oid) ?? Infinity))
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

type Row = [string, number, number, number]

/**
 * git.statusMatrix, with files that look unchanged checked by their content
 * when they were written about as late as the index: git's stat cache cannot
 * tell a same-second, same-size change ("racy git"), and isomorphic-git does
 * not look again as the system git does.
 */
async function statusRows(root: string, filepaths?: string[]): Promise<Row[]> {
  const rows = (await git.statusMatrix({ fs, dir: root, filepaths })) as Row[]
  let indexTime: number
  try {
    indexTime = Math.floor(fs.statSync(join(root, '.git', 'index')).mtimeMs / 1000)
  } catch {
    return rows
  }
  let head: string | null = null
  for (const row of rows) {
    const [filepath, h, w, st] = row
    if (!(h === 1 && w === 1 && st === 1)) continue
    const path = join(root, ...filepath.split('/'))
    let stat: fs.Stats
    try {
      stat = fs.statSync(path)
    } catch {
      continue
    }
    if (Math.floor(stat.mtimeMs / 1000) < indexTime) continue
    head ??= await git.resolveRef({ fs, dir: root, ref: 'HEAD' })
    const [{ oid: now }, { oid: then }] = await Promise.all([
      git.hashBlob({ object: fs.readFileSync(path) }),
      git.readBlob({ fs, dir: root, oid: head, filepath }),
    ])
    if (now !== then) row[2] = 2
  }
  return rows
}

/** The status of the files under a folder of the repository, by their absolute paths. */
export async function statusUnder(root: string, dir: string): Promise<Map<string, FileStatus>> {
  const prefix = toGit(root, dir)
  const out = new Map<string, FileStatus>()
  let matrix: [string, number, number, number][]
  try {
    matrix = await statusRows(root, prefix === '' ? undefined : [prefix])
  } catch {
    return out
  }
  for (const [filepath, head, workdir] of matrix) {
    const status: FileStatus = head === 0 ? 'new' : workdir === 0 ? 'deleted' : head !== workdir ? 'modified' : 'clean'
    if (status !== 'clean') out.set(join(root, ...filepath.split('/')), status)
  }
  return out
}

// Branches, merges (stage 4b) ----------------------------------------------------------

export type GitErrorCode = 'dirty' | 'merging' | 'no-remote' | 'detached' | 'auth' | 'network' | 'invalid' | 'markers' | 'exists'

/** A refusal with a reason the window can say: `detail` holds files, a host or git's own words. */
export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    readonly detail: string[] = [],
  ) {
    super(`${code}${detail.length ? `: ${detail.join(', ')}` : ''}`)
  }
}

export interface Branches {
  current: string | null
  local: string[]
}

export async function branchesOf(root: string): Promise<Branches> {
  try {
    const local = (await git.listBranches({ fs, dir: root })).sort((a, b) => a.localeCompare(b))
    return { current: await branchOf(root), local }
  } catch {
    return { current: null, local: [] }
  }
}

/**
 * Files whose committed state would be lost by moving to another commit:
 * changed or removed tracked files, and new files already added. Files git
 * does not know stay where they are, so they do not count.
 */
export async function changedFiles(root: string): Promise<string[]> {
  const matrix = await statusRows(root)
  return matrix
    .filter(([, head, workdir, stage]) => (head === 0 ? stage !== 0 : workdir !== head || stage !== head))
    .map(([filepath]) => join(root, ...filepath.split('/')))
}

export async function createBranch(root: string, name: string): Promise<void> {
  try {
    await git.branch({ fs, dir: root, ref: name, checkout: true })
  } catch (e) {
    const code = (e as { code?: string }).code
    throw new GitError(code === 'AlreadyExistsError' ? 'exists' : 'invalid', [name])
  }
}

/** Move to another branch; refused while files have changes a move would overwrite. */
export async function switchBranch(root: string, name: string): Promise<void> {
  if (mergeHead(root)) throw new GitError('merging')
  const changed = await changedFiles(root)
  if (changed.length > 0) throw new GitError('dirty', changed)
  try {
    await git.checkout({ fs, dir: root, ref: name })
  } catch (e) {
    // An untracked file in the way of one the branch has.
    const data = (e as { data?: { filepaths?: string[] } }).data
    throw new GitError('dirty', (data?.filepaths ?? []).map((p) => join(root, ...p.split('/'))))
  }
}

export async function remoteOf(root: string): Promise<{ name: string; url: string } | null> {
  try {
    const remotes = await git.listRemotes({ fs, dir: root })
    const branch = await branchOf(root)
    const configured = branch ? await git.getConfig({ fs, dir: root, path: `branch.${branch}.remote` }) : undefined
    const remote = remotes.find((r) => r.remote === configured) ?? remotes.find((r) => r.remote === 'origin') ?? remotes[0]
    return remote ? { name: remote.remote, url: remote.url } : null
  } catch {
    return null
  }
}

export async function setRemote(root: string, url: string): Promise<void> {
  await git.addRemote({ fs, dir: root, remote: 'origin', url, force: true })
}

/** Remember where a branch goes: what `git pull` / `git push` of the system git use too. */
export async function setUpstream(root: string, branch: string, remote: string): Promise<void> {
  await git.setConfig({ fs, dir: root, path: `branch.${branch}.remote`, value: remote })
  await git.setConfig({ fs, dir: root, path: `branch.${branch}.merge`, value: `refs/heads/${branch}` })
}

/** Commits the branch has that the remote's has not, and the other way, as last fetched. */
export async function aheadBehind(root: string, branch: string, remote: string): Promise<{ ahead: number; behind: number } | null> {
  let ours: string
  let theirs: string
  try {
    ours = await git.resolveRef({ fs, dir: root, ref: `refs/heads/${branch}` })
    theirs = await git.resolveRef({ fs, dir: root, ref: `refs/remotes/${remote}/${branch}` })
  } catch {
    return null
  }
  if (ours === theirs) return { ahead: 0, behind: 0 }
  const reach = async (oid: string) => new Set((await git.log({ fs, dir: root, ref: oid, depth: 5000 })).map((e) => e.oid))
  const [a, b] = await Promise.all([reach(ours), reach(theirs)])
  let ahead = 0
  let behind = 0
  for (const oid of a) if (!b.has(oid)) ahead++
  for (const oid of b) if (!a.has(oid)) behind++
  return { ahead, behind }
}

// A merge in progress is kept the way git keeps it, so the system git sees it too.
const MERGE_FILES = ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE']

export function mergeHead(root: string): string | null {
  try {
    return fs.readFileSync(join(root, '.git', 'MERGE_HEAD'), 'utf8').trim().split('\n')[0] || null
  } catch {
    return null
  }
}

export function startMerge(root: string, theirs: string, message: string): void {
  fs.writeFileSync(join(root, '.git', 'MERGE_HEAD'), `${theirs}\n`)
  fs.writeFileSync(join(root, '.git', 'MERGE_MSG'), `${message}\n`)
}

function endMerge(root: string): void {
  for (const name of MERGE_FILES) fs.rmSync(join(root, '.git', name), { force: true })
}

const MARKER = /^(<{7}|>{7})( |$)/m

/** While merging: the files still holding conflict markers. */
export async function conflictsOf(root: string): Promise<string[]> {
  if (!mergeHead(root)) return []
  const out: string[] = []
  for (const path of await changedFiles(root)) {
    try {
      if (MARKER.test(fs.readFileSync(path, 'utf8'))) out.push(path)
    } catch {
      // Removed: nothing to resolve in it.
    }
  }
  return out
}

/** Commit the resolved merge: every change, with both sides as parents. */
export async function finishMerge(root: string, author: Author): Promise<string> {
  const theirs = mergeHead(root)
  if (!theirs) throw new GitError('invalid')
  const left = await conflictsOf(root)
  if (left.length > 0) throw new GitError('markers', left)
  for (const [filepath, , workdir] of await statusRows(root)) {
    if (workdir === 0) await git.remove({ fs, dir: root, filepath })
    else await git.add({ fs, dir: root, filepath })
  }
  let message = 'Merge'
  try {
    message = fs.readFileSync(join(root, '.git', 'MERGE_MSG'), 'utf8').trim() || message
  } catch {
    // The default.
  }
  const ours = await git.resolveRef({ fs, dir: root, ref: 'HEAD' })
  const oid = await git.commit({ fs, dir: root, message, author, parent: [ours, theirs] })
  endMerge(root)
  return oid
}

/** Give the merge up: the files as the branch has them, the merge forgotten. */
export async function abortMerge(root: string): Promise<void> {
  const branch = await branchOf(root)
  await git.checkout({ fs, dir: root, ref: branch ?? 'HEAD', force: true })
  // Files the other side added, never committed here: gone with the merge.
  for (const [filepath, head, , stage] of await git.statusMatrix({ fs, dir: root })) {
    if (head === 0 && stage !== 0) {
      await git.remove({ fs, dir: root, filepath })
      fs.rmSync(join(root, ...filepath.split('/')), { force: true })
    }
  }
  endMerge(root)
}
