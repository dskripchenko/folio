import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import { join } from 'node:path'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { aheadBehind, branchOf, changedFiles, GitError, mergeHead, remoteOf, setUpstream, startMerge, type Author } from './git'

/**
 * Synchronising with a remote (ADR-001, stage 4b). The network goes through
 * the system's git when there is one — its credential helpers and SSH keys
 * work as they do in a terminal — or through isomorphic-git over HTTPS with a
 * token otherwise. Merging is the same for both: done here, locally.
 */
export interface Login {
  username: string
  password: string
}

export interface Transport {
  readonly kind: 'system' | 'builtin'
  fetch(root: string, remote: string): Promise<void>
  push(root: string, remote: string, branch: string): Promise<void>
  /** The repository's tags sent (the ones the remote has are left as they are). */
  pushTags(root: string, remote: string): Promise<void>
  clone(url: string, dir: string): Promise<void>
}

/** The system's git, if it answers; `FOLIO_GIT=builtin` does without it. */
export function findSystemGit(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (env.FOLIO_GIT === 'builtin') return Promise.resolve(null)
  const bin = env.FOLIO_GIT || 'git'
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 10_000, windowsHide: true }, (error) => resolve(error ? null : bin))
  })
}

/** git's words about a failure: a login problem, or anything else the network did. */
export function classify(stderr: string, host = ''): GitError {
  const words = stderr.trim().split(/\r?\n/).filter(Boolean)
  const last = words.slice(-3).join('\n')
  if (/authentication failed|could not read (username|password)|permission denied|\b40[13]\b|terminal prompts disabled/i.test(stderr)) {
    return new GitError('auth', [host || last])
  }
  return new GitError('network', [last])
}

export function systemTransport(bin: string): Transport {
  const run = (args: string[], cwd?: string) =>
    new Promise<void>((resolve, reject) => {
      execFile(
        bin,
        args,
        // Never wait for a password typed into a terminal nobody sees.
        { cwd, timeout: 5 * 60_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 16 << 20 },
        (error, _stdout, stderr) => (error ? reject(classify(`${stderr}\n${error.message}`)) : resolve()),
      )
    })
  return {
    kind: 'system',
    fetch: (root, remote) => run(['fetch', '--prune', remote], root),
    push: (root, remote, branch) => run(['push', '--set-upstream', remote, `refs/heads/${branch}:refs/heads/${branch}`], root),
    pushTags: (root, remote) => run(['push', remote, '--tags'], root),
    clone: (url, dir) => run(['clone', '--', url, dir]),
  }
}

const hostOf = (url: string) => {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return url
  }
}

/** isomorphic-git over HTTPS; `login` gives the saved user and token of a remote's host. */
export function builtinTransport(login: (url: string) => Login | undefined): Transport {
  const auth = (url: string) => ({
    onAuth: () => login(url) ?? undefined,
    // A refused login is not tried again and again.
    onAuthFailure: () => ({ cancel: true }),
  })
  const fail = (url: string) => (e: unknown): never => {
    if (e instanceof GitError) throw e
    const err = e as { code?: string; data?: { statusCode?: number }; message?: string }
    const status = err.data?.statusCode
    if (err.code === 'UserCanceledError' || status === 401 || status === 403) throw new GitError('auth', [hostOf(url)])
    if (err.code === 'UrlParseError' || !/^https?:\/\//i.test(url)) throw new GitError('network', [`${url}: only https:// works without git installed`])
    throw new GitError('network', [err.message ?? String(e)])
  }
  const urlOf = async (root: string, remote: string) => (await git.getConfig({ fs, dir: root, path: `remote.${remote}.url` })) as string
  return {
    kind: 'builtin',
    async fetch(root, remote) {
      const url = await urlOf(root, remote)
      await git.fetch({ fs, http, dir: root, remote, prune: true, ...auth(url) }).catch(fail(url))
    },
    async push(root, remote, branch) {
      const url = await urlOf(root, remote)
      const result = await git.push({ fs, http, dir: root, remote, ref: branch, remoteRef: branch, ...auth(url) }).catch(fail(url))
      if (!result.ok) throw new GitError('network', [result.error ?? 'push refused'])
      await setUpstream(root, branch, remote)
    },
    async pushTags(root, remote) {
      const url = await urlOf(root, remote)
      for (const tag of await git.listTags({ fs, dir: root })) {
        const result = await git.push({ fs, http, dir: root, remote, ref: `refs/tags/${tag}`, remoteRef: `refs/tags/${tag}`, ...auth(url) }).catch(fail(url))
        if (!result.ok) throw new GitError('network', [result.error ?? 'push refused'])
      }
    },
    async clone(url, dir) {
      await git.clone({ fs, http, dir, url, ...auth(url) }).catch(fail(url))
    },
  }
}

export type SyncResult =
  | { result: 'up-to-date' | 'pushed' | 'pulled' | 'merged' }
  | { result: 'conflict'; conflicts: string[] }

/**
 * Fetch; then take the remote's commits (fast-forward, or a merge commit),
 * and send ours. A merge that conflicts leaves the markers in the files and
 * the merge open (MERGE_HEAD), to be finished once they are resolved.
 */
export async function syncRepo(root: string, transport: Transport, author: Author): Promise<SyncResult> {
  const result = await syncBranch(root, transport, author)
  // Tags made here go out too (a conflict waits: nothing was sent).
  if (result.result !== 'conflict' && (await git.listTags({ fs, dir: root })).length > 0) {
    const remote = await remoteOf(root)
    if (remote) await transport.pushTags(root, remote.name)
  }
  return result
}

async function syncBranch(root: string, transport: Transport, author: Author): Promise<SyncResult> {
  if (mergeHead(root)) throw new GitError('merging')
  const branch = await branchOf(root)
  if (!branch) throw new GitError('detached')
  const remote = await remoteOf(root)
  if (!remote) throw new GitError('no-remote')
  const changed = await changedFiles(root)
  if (changed.length > 0) throw new GitError('dirty', changed)

  await transport.fetch(root, remote.name)
  const counts = await aheadBehind(root, branch, remote.name)
  if (counts === null) {
    // The remote has no such branch yet.
    await transport.push(root, remote.name, branch)
    return { result: 'pushed' }
  }
  if (counts.ahead === 0 && counts.behind === 0) return { result: 'up-to-date' }
  if (counts.behind === 0) {
    await transport.push(root, remote.name, branch)
    return { result: 'pushed' }
  }
  const theirsRef = `refs/remotes/${remote.name}/${branch}`
  const theirs = await git.resolveRef({ fs, dir: root, ref: theirsRef })
  if (counts.ahead === 0) {
    await git.writeRef({ fs, dir: root, ref: `refs/heads/${branch}`, value: theirs, force: true })
    await git.checkout({ fs, dir: root, ref: branch })
    return { result: 'pulled' }
  }
  const message = `Merge ${remote.name}/${branch} into ${branch}`
  try {
    await git.merge({ fs, dir: root, ours: branch, theirs: theirsRef, author, message, abortOnConflict: false })
  } catch (e) {
    const err = e as { code?: string; data?: { filepaths?: string[] } }
    if (err.code !== 'MergeConflictError') throw e
    startMerge(root, theirs, message)
    return { result: 'conflict', conflicts: (err.data?.filepaths ?? []).map((p) => join(root, ...p.split('/'))) }
  }
  // The merge commit is made beside the files: bring them to it (nothing was changed here — checked above).
  await git.checkout({ fs, dir: root, ref: branch, force: true })
  await transport.push(root, remote.name, branch)
  return { result: 'merged' }
}

/** The folder a clone goes to: the repository's name within the chosen parent. */
export function cloneTarget(parent: string, url: string): string {
  const name = url.replace(/[?#].*$/, '').replace(/[\\/]+$/, '').split(/[\\/:]/).pop()?.replace(/\.git$/i, '') || 'repository'
  return join(parent, name)
}

export async function cloneInto(transport: Transport, url: string, dir: string): Promise<void> {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new GitError('exists', [dir])
  await transport.clone(url, dir)
}
