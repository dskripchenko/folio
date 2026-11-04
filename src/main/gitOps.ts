import { execFile } from 'node:child_process'
import fs from 'node:fs'
import git from 'isomorphic-git'
import type { Author } from './git'
import { branchOf, changedFiles, GitError } from './git'

/**
 * The repository's everyday operations beyond committing (ADR-004 D4): put
 * changes aside (stash) and take them back, fix the last commit (amend), undo
 * a commit with a new one (revert), rename and delete branches, tags.
 *
 * Stash and revert run the system's git: isomorphic-git's stash sees staged
 * changes only and never new files, and it has no revert. Without git
 * installed they are refused with `no-git`; the rest is isomorphic-git.
 */

export interface Stash {
  index: number
  message: string
  /** Seconds since the epoch. */
  time: number
}

function run(bin: string, root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd: root, timeout: 60_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }, maxBuffer: 16 << 20 },
      (error, stdout, stderr) => (error ? reject(new GitError('failed', [`${stderr}`.trim() || error.message])) : resolve(stdout)),
    )
  })
}

function needGit(bin: string | null): string {
  if (!bin) throw new GitError('no-git')
  return bin
}

/** What is put aside, newest first. */
export async function stashList(bin: string | null, root: string): Promise<Stash[]> {
  if (!bin) return []
  const out = await run(bin, root, ['stash', 'list', '--format=%gd%x00%ct%x00%gs'])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref = '', time = '0', subject = ''] = line.split('\0')
      return { index: Number(/\{(\d+)\}/.exec(ref)?.[1] ?? 0), time: Number(time), message: subject.replace(/^On [^:]+: /, '').replace(/^WIP on [^:]+: /, '') }
    })
}

/** Every change put aside (new files too), the working tree back to the last commit. */
export async function stashPush(bin: string | null, root: string, message: string, author: Author): Promise<void> {
  const g = needGit(bin)
  if ((await changedFiles(root)).length === 0) throw new GitError('nothing')
  const who = ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`]
  await run(g, root, [...who, 'stash', 'push', '--include-untracked', ...(message.trim() ? ['-m', message.trim()] : [])])
}

/** Changes put aside taken back (`pop`: and dropped from the list); a clash leaves them in the list. */
export async function stashApply(bin: string | null, root: string, index: number, pop: boolean): Promise<void> {
  const g = needGit(bin)
  await run(g, root, ['stash', pop ? 'pop' : 'apply', `stash@{${index}}`])
}

export async function stashDrop(bin: string | null, root: string, index: number): Promise<void> {
  const g = needGit(bin)
  await run(g, root, ['stash', 'drop', `stash@{${index}}`])
}

/** The last commit's message, to start an amend from. */
export async function lastMessage(root: string): Promise<string | null> {
  try {
    const [head] = await git.log({ fs, dir: root, depth: 1 })
    return head?.commit.message.trimEnd() ?? null
  } catch {
    return null
  }
}

/** The last commit made again: with what is staged now and this message. */
export async function amendLast(root: string, message: string, author: Author): Promise<string> {
  return git.commit({ fs, dir: root, message, author, amend: true })
}

/** A commit undone by a new one; one that does not apply cleanly is given up, the tree as it was. */
export async function revertCommit(bin: string | null, root: string, oid: string, author: Author): Promise<void> {
  const g = needGit(bin)
  const changed = await changedFiles(root)
  if (changed.length > 0) throw new GitError('dirty', changed)
  const who = ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`]
  try {
    await run(g, root, [...who, 'revert', '--no-edit', oid])
  } catch (e) {
    await run(g, root, ['revert', '--abort']).catch(() => {})
    throw e instanceof GitError && /conflict/i.test(e.detail.join(' ')) ? new GitError('conflict') : e
  }
}

/** A name git takes for a branch or a tag. */
const validRef = (name: string): boolean =>
  // No control characters, and none of what git keeps out of a name (spaces, ~ ^ : ? * [ \\, `..`, `@{`, a leading or doubled /, a trailing . / or .lock).
  ![...name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) &&
  /^(?!\/|.*(\.\.|\/\/|@\{|\\))[^\s~^:?*[]+(?<![./]|\.lock)$/.test(name)

export async function renameBranch(root: string, from: string, to: string): Promise<void> {
  if (!validRef(to)) throw new GitError('invalid')
  const current = await branchOf(root)
  await git.renameBranch({ fs, dir: root, oldref: from, ref: to, checkout: current === from })
}

/** A branch removed — never the one checked out. */
export async function deleteBranch(root: string, name: string): Promise<void> {
  if ((await branchOf(root)) === name) throw new GitError('current')
  await git.deleteBranch({ fs, dir: root, ref: name })
}

export async function tagsOf(root: string): Promise<string[]> {
  return git.listTags({ fs, dir: root })
}

/** A tag on a commit: with a message it is annotated (who, when, why), else a plain name. */
export async function createTag(root: string, name: string, oid: string, message: string, author: Author): Promise<void> {
  if (!validRef(name)) throw new GitError('invalid')
  if ((await tagsOf(root)).includes(name)) throw new GitError('exists', [name])
  if (message.trim()) await git.annotatedTag({ fs, dir: root, ref: name, object: oid, message: message.trim(), tagger: author })
  else await git.tag({ fs, dir: root, ref: name, object: oid })
}

export async function deleteTag(root: string, name: string): Promise<void> {
  await git.deleteTag({ fs, dir: root, ref: name })
}
