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
 * A file's content as git stores it. With `core.autocrlf` (Git for Windows'
 * default) a checkout has CRLF while the commits hold LF; isomorphic-git
 * knows nothing of it, so a text file's CRLF go back to LF unless the
 * committed version keeps CRs of its own.
 */
export function stored(content: Buffer, committed: Uint8Array | null): Buffer {
  if (content.includes(0) || !content.includes('\r\n') || (committed && committed.includes(13))) return content
  return Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1')
}

async function headBlob(root: string, filepath: string, head?: string): Promise<{ oid: string; blob: Uint8Array } | null> {
  try {
    const oid = head ?? (await git.resolveRef({ fs, dir: root, ref: 'HEAD' }))
    return await git.readBlob({ fs, dir: root, oid, filepath })
  } catch {
    return null
  }
}

/** Add a file to the index as git would store it. */
async function stage(root: string, filepath: string, raw: Buffer, content: Buffer): Promise<void> {
  if (content === raw) return git.add({ fs, dir: root, filepath })
  const oid = await git.writeBlob({ fs, dir: root, blob: content })
  await git.updateIndex({ fs, dir: root, filepath, oid, add: true })
}

/**
 * Commit one file as it is on disk (added, changed or removed); null when
 * nothing changed. Compared by content, not by git's stat cache: a save in
 * the same second as the last commit, of the same size, must still count.
 */
export async function commitFile(root: string, path: string, message: string, author: Author): Promise<string | null> {
  const filepath = toGit(root, path)
  const committed = await headBlob(root, filepath)
  if (fs.existsSync(path)) {
    const raw = fs.readFileSync(path)
    const content = stored(raw, committed?.blob ?? null)
    const { oid } = await git.hashBlob({ object: content })
    if (oid === committed?.oid) return null
    await stage(root, filepath, raw, content)
  } else {
    if (committed === null) return null
    await git.remove({ fs, dir: root, filepath })
  }
  return git.commit({ fs, dir: root, message, author })
}

/** Commit several files at once (a replacement across a folder): one commit, null when nothing changed. */
export async function commitFiles(root: string, paths: string[], message: string, author: Author): Promise<string | null> {
  let staged = false
  for (const path of paths) {
    const filepath = toGit(root, path)
    const committed = await headBlob(root, filepath)
    if (!fs.existsSync(path)) continue
    const raw = fs.readFileSync(path)
    const content = stored(raw, committed?.blob ?? null)
    const { oid } = await git.hashBlob({ object: content })
    if (oid === committed?.oid) continue
    await stage(root, filepath, raw, content)
    staged = true
  }
  return staged ? git.commit({ fs, dir: root, message, author }) : null
}

/** A commit of a history list: `parents` within the list shown (see `historyOf`), `refs` naming it. */
export interface Version {
  oid: string
  message: string
  author: string
  email: string
  /** Seconds since the epoch. */
  time: number
  parents: string[]
  refs: string[]
}

type LogEntry = Awaited<ReturnType<typeof git.log>>[number]

const versionOf = (e: LogEntry, parents: string[], refs: string[] = []): Version => ({
  oid: e.oid,
  message: e.commit.message.trim(),
  author: e.commit.author.name,
  email: e.commit.author.email,
  time: e.commit.author.timestamp,
  parents,
  refs,
})

/**
 * Parents rewritten to the nearest commits of a subset, as `git log -- file`
 * simplifies history: a line of a commit graph runs from a version to the
 * versions before it, through the commits that did not touch the file. The
 * one reached down the first parents comes first.
 */
export function rewriteParents(oid: string, keep: ReadonlySet<string>, parentsOf: (oid: string) => readonly string[] | undefined): string[] {
  // The first parent is the one down the first-parent line: the main line stays the main lane.
  let first = parentsOf(oid)?.[0]
  const line = new Set<string>()
  while (first !== undefined && !keep.has(first) && !line.has(first)) {
    line.add(first)
    first = parentsOf(first)?.[0]
  }
  const out: string[] = first !== undefined && keep.has(first) ? [first] : []
  const seen = new Set<string>()
  const queue = [...(parentsOf(oid) ?? [])]
  while (queue.length > 0) {
    const x = queue.shift()!
    if (seen.has(x)) continue
    seen.add(x)
    if (keep.has(x)) {
      if (!out.includes(x)) out.push(x)
      continue
    }
    queue.push(...(parentsOf(x) ?? []))
  }
  return out
}

/**
 * The versions of a file, newest first, with their parents among these
 * versions. A commit is a version when the file in it differs from the file
 * in every one of its parents (git's rule: a merge that took one side's file
 * as it was is not one). Worked out here from the history itself:
 * isomorphic-git's file log compares commits in date order, which within one
 * second can set a commit beside another that is not its parent.
 */
export async function historyOf(root: string, path: string, depth = 200): Promise<Version[]> {
  const filepath = toGit(root, path)
  const cache = {}
  let walk: LogEntry[]
  try {
    walk = await git.log({ fs, dir: root, depth: Math.max(depth * 5, 1000), cache })
  } catch {
    // No commit yet.
    return []
  }
  const blobs = new Map<string, string | null>()
  const blobAt = async (oid: string): Promise<string | null> => {
    if (!blobs.has(oid)) {
      try {
        blobs.set(oid, (await git.readBlob({ fs, dir: root, oid, filepath, cache })).oid)
      } catch {
        blobs.set(oid, null)
      }
    }
    return blobs.get(oid)!
  }
  // isomorphic-git may list a commit twice when a merge leads to it on two paths, and orders by date alone.
  walk = topological([...new Map(walk.map((e) => [e.oid, e])).values()])
  const versions: LogEntry[] = []
  for (const e of walk) {
    const mine = await blobAt(e.oid)
    if (mine === null) continue
    const parents = await Promise.all(e.commit.parent.map(blobAt))
    if (parents.every((p) => p !== mine)) versions.push(e)
    if (versions.length >= depth) break
  }
  const keep = new Set(versions.map((e) => e.oid))
  const parentsOf = new Map(walk.map((e) => [e.oid, e.commit.parent]))
  return versions.map((e) => versionOf(e, rewriteParents(e.oid, keep, (oid) => parentsOf.get(oid))))
}

/**
 * Commits in the order a history is read: a child always above its parents;
 * among the commits free to go next, the newest, and on a tie (commits of one
 * second) the one met first. Dates alone do not do it: a branch's commit and
 * the commit it started from may share a second.
 */
function topological(entries: LogEntry[], limit = Infinity): LogEntry[] {
  const byOid = new Map(entries.map((e) => [e.oid, e]))
  const seen = new Map(entries.map((e, i) => [e.oid, i]))
  const children = new Map<string, number>()
  for (const e of byOid.values()) for (const p of e.commit.parent) if (byOid.has(p)) children.set(p, (children.get(p) ?? 0) + 1)
  const ready = [...byOid.values()].filter((e) => !children.get(e.oid))
  const out: LogEntry[] = []
  const when = (e: LogEntry) => e.commit.committer.timestamp
  const before = (a: LogEntry, b: LogEntry) => when(a) > when(b) || (when(a) === when(b) && seen.get(a.oid)! < seen.get(b.oid)!)
  while (ready.length > 0 && out.length < limit) {
    let best = 0
    for (let i = 1; i < ready.length; i++) if (before(ready[i]!, ready[best]!)) best = i
    const e = ready.splice(best, 1)[0]!
    out.push(e)
    for (const p of e.commit.parent) {
      const left = (children.get(p) ?? 0) - 1
      children.set(p, left)
      const parent = byOid.get(p)
      if (left === 0 && parent) ready.push(parent)
    }
  }
  return out
}

/**
 * Every commit of the repository — of its branches, the remotes' branches as
 * last fetched and its tags — newest first, a child always above its
 * parents, up to `limit`; `refs` name the branches and tags on each.
 */
export async function repositoryHistory(root: string, limit = 300): Promise<Version[]> {
  const tips = new Map<string, string[]>()
  const name = (oid: string, ref: string) => tips.set(oid, [...(tips.get(oid) ?? []), ref])
  const resolve = async (ref: string) => {
    try {
      return await git.resolveRef({ fs, dir: root, ref })
    } catch {
      return null
    }
  }
  const current = await branchOf(root)
  try {
    for (const b of await git.listBranches({ fs, dir: root })) {
      const oid = await resolve(`refs/heads/${b}`)
      if (oid) name(oid, b === current ? `HEAD -> ${b}` : b)
    }
    for (const r of await git.listRemotes({ fs, dir: root })) {
      for (const b of await git.listBranches({ fs, dir: root, remote: r.remote })) {
        if (b === 'HEAD') continue
        const oid = await resolve(`refs/remotes/${r.remote}/${b}`)
        if (oid) name(oid, `${r.remote}/${b}`)
      }
    }
    for (const tag of await git.listTags({ fs, dir: root })) {
      let oid = await resolve(`refs/tags/${tag}`)
      if (!oid) continue
      // An annotated tag points at a tag object: the commit is behind it.
      try {
        oid = (await git.readTag({ fs, dir: root, oid })).tag.object
      } catch {
        // A lightweight tag: the commit itself.
      }
      name(oid, `tag: ${tag}`)
    }
  } catch {
    return []
  }
  if (!current) {
    const head = await resolve('HEAD')
    if (head) name(head, 'HEAD')
  }
  const commits = new Map<string, LogEntry>()
  for (const tip of tips.keys()) {
    try {
      for (const e of await git.log({ fs, dir: root, ref: tip, depth: limit })) commits.set(e.oid, e)
    } catch {
      // A ref to a commit that is not here (a shallow clone).
    }
  }
  return topological([...commits.values()], limit).map((e) => versionOf(e, e.commit.parent, tips.get(e.oid)))
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
 * git.statusMatrix, checked by content where it guesses: a file that looks
 * unchanged but was written as late as the index (git's stat cache cannot
 * tell a same-second, same-size change — "racy git" — and isomorphic-git
 * does not look again as the system git does), and a changed one that may
 * differ only by line endings (`stored`).
 */
async function statusRows(root: string, filepaths?: string[]): Promise<Row[]> {
  const rows = (await git.statusMatrix({ fs, dir: root, filepaths })) as Row[]
  let indexTime = Infinity
  try {
    indexTime = Math.floor(fs.statSync(join(root, '.git', 'index')).mtimeMs / 1000)
  } catch {
    // No index: nothing is racily clean.
  }
  let head: string | undefined
  for (const row of rows) {
    const [filepath, h, w, st] = row
    if (h !== 1 || w === 0) continue
    const path = join(root, ...filepath.split('/'))
    const clean = w === 1 && st === 1
    if (clean) {
      try {
        if (Math.floor(fs.statSync(path).mtimeMs / 1000) < indexTime) continue
      } catch {
        continue
      }
    } else if (!(w === 2 && st === 1)) continue
    head ??= await git.resolveRef({ fs, dir: root, ref: 'HEAD' })
    const committed = await headBlob(root, filepath, head)
    if (!committed) continue
    const { oid } = await git.hashBlob({ object: stored(fs.readFileSync(path), committed.blob) })
    row[2] = oid === committed.oid ? 1 : 2
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

/**
 * A remote's address as git's config can hold it: isomorphic-git writes the
 * value as it is, and a Windows path's backslashes would read as escapes
 * (the system git refuses the file) — a local path goes in with `/`.
 */
export function remoteUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : url.replaceAll('\\', '/')
}

export async function setRemote(root: string, url: string): Promise<void> {
  await git.addRemote({ fs, dir: root, remote: 'origin', url: remoteUrl(url), force: true })
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
    else {
      const raw = fs.readFileSync(join(root, ...filepath.split('/')))
      await stage(root, filepath, raw, stored(raw, (await headBlob(root, filepath))?.blob ?? null))
    }
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
