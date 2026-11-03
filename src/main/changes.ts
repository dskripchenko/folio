import * as fs from 'node:fs'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { headBlob, stage, statusRows, stored, toGit, type Author } from './git'

/**
 * The changes of a repository, as a code editor's source control shows them
 * (ADR-002, I1): what is staged for the next commit, and what is changed in
 * the working folder beside it; staged and unstaged a file at a time, a
 * file's changes thrown away, the staged ones committed.
 */

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'untracked'

export interface Change {
  /** `/`-separated, from the repository's root. */
  path: string
  kind: ChangeKind
}

export interface Changes {
  staged: Change[]
  unstaged: Change[]
}

/**
 * From git's status matrix (HEAD, working folder, index: 0 absent, 1 as in
 * HEAD, 2 as in the working folder / different from HEAD, 3 different from both).
 */
export function changesOfRows(rows: readonly (readonly [string, number, number, number])[]): Changes {
  const staged: Change[] = []
  const unstaged: Change[] = []
  for (const [path, head, workdir, index] of rows) {
    // Staged: the index against HEAD.
    if (head === 0 && index !== 0) staged.push({ path, kind: 'added' })
    else if (head === 1 && index === 0) staged.push({ path, kind: 'deleted' })
    else if (head === 1 && (index === 2 || index === 3)) staged.push({ path, kind: 'modified' })
    // Unstaged: the working folder against the index.
    if (head === 0 && index === 0 && workdir !== 0) unstaged.push({ path, kind: 'untracked' })
    else if (index !== 0 && workdir === 0) unstaged.push({ path, kind: 'deleted' })
    else if (index === 3) unstaged.push({ path, kind: 'modified' })
    else if (index === 1 && workdir === 2) unstaged.push({ path, kind: 'modified' })
  }
  const order = (a: Change, b: Change) => a.path.localeCompare(b.path)
  return { staged: staged.sort(order), unstaged: unstaged.sort(order) }
}

export async function changesOf(root: string): Promise<Changes> {
  return changesOfRows(await statusRows(root))
}

/** Into the index as they are on disk (a removed one: its removal). */
export async function stageFiles(root: string, paths: readonly string[]): Promise<void> {
  for (const filepath of paths) {
    const full = join(root, ...filepath.split('/'))
    if (!fs.existsSync(full)) {
      await git.remove({ fs, dir: root, filepath })
      continue
    }
    const raw = fs.readFileSync(full)
    const committed = await headBlob(root, filepath)
    await stage(root, filepath, raw, stored(raw, committed?.blob ?? null))
  }
}

/** Out of the index: back to HEAD there (a file new to git: out of the index altogether). */
export async function unstageFiles(root: string, paths: readonly string[]): Promise<void> {
  for (const filepath of paths) {
    const committed = await headBlob(root, filepath)
    if (committed) await git.resetIndex({ fs, dir: root, filepath })
    else await git.remove({ fs, dir: root, filepath })
  }
}

/**
 * A file's changes thrown away: back to the index's version (or HEAD's when
 * it is not staged); a file git does not know is removed. The caller asks first.
 */
export async function discardFile(root: string, filepath: string): Promise<void> {
  const full = join(root, ...filepath.split('/'))
  const rows = await statusRows(root, [filepath])
  const row = rows.find((r) => r[0] === filepath)
  if (row && row[1] === 0 && row[3] === 0) {
    fs.rmSync(full, { force: true })
    return
  }
  // The index's version of the file: what the working folder goes back to.
  let oid: string | null
  const index = await git.listFiles({ fs, dir: root })
  if (index.includes(filepath)) {
    const entries = await git.walk({
      fs,
      dir: root,
      trees: [git.STAGE()],
      // Down the folders on the way to the file only: `null` or `undefined` leaves a folder unwalked, `''` goes on.
      map: async (p, [entry]) => {
        if (p === filepath) return entry ? ((await entry.oid()) ?? '') : ''
        return p === '.' || filepath.startsWith(p + '/') ? '' : undefined
      },
    })
    oid = ([entries].flat(Infinity) as unknown[]).find((x): x is string => typeof x === 'string' && x.length === 40) ?? null
  } else oid = (await headBlob(root, filepath))?.oid ?? null
  if (!oid) {
    fs.rmSync(full, { force: true })
    return
  }
  const { blob } = await git.readBlob({ fs, dir: root, oid })
  fs.mkdirSync(join(full, '..'), { recursive: true })
  // Line endings as the file had them on disk (`stored` turned CRLF into LF for git).
  const text = Buffer.from(blob)
  let crlf = false
  try {
    crlf = fs.readFileSync(full).includes('\r\n')
  } catch {
    // Gone from disk: written as git keeps it.
  }
  fs.writeFileSync(full, crlf && !text.includes('\r\n') ? Buffer.from(text.toString('utf8').replace(/\n/g, '\r\n')) : text)
}

/** The staged changes committed; null when nothing is staged. */
export async function commitStaged(root: string, message: string, author: Author): Promise<string | null> {
  const { staged } = await changesOf(root)
  if (staged.length === 0) return null
  return git.commit({ fs, dir: root, message, author })
}

export { toGit }
