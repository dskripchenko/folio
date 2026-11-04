import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Hunk } from '../../common/hunks'
import { commentOf, type ChangedFile, type ChangeSpec } from '../../common/review'
import { GitError } from '../git'
import { ReviewGit } from './git'
import { ReviewStore } from './store'

/**
 * The review's channels to the window (ADR-006): sets of changes, a file's
 * texts, the working copy's actions, worktrees. What the window sends is
 * checked: a repository folio can open, revisions that are not options,
 * paths inside the repository.
 */
export interface ReviewDeps {
  /** Where the review keeps its marks: `folio-data/review`. */
  dir: string
  systemGit: () => Promise<string | null>
  repoOf: (path: string) => Promise<string | null>
  /** Asked before anything is thrown away. */
  confirm: (message: string, detail: string, yes: string) => Promise<boolean>
  trash: (path: string) => Promise<void>
  /** The window told that files or the repository changed. */
  changed: (repo: string) => void
  /** A worktree added to folio's projects; the workspace as the sidebar draws it. */
  addProject: (path: string) => unknown
  /** A removed worktree's project (if it was one) let go; the workspace as the sidebar draws it. */
  forgetProject: (path: string) => unknown
  text: () => { discardFileQuestion: string; discardFileDetail: string; discard: string; removeWorktreeQuestion: string; removeWorktreeDetail: string; removeWorktreeDirty: string; remove: string }
}

const REV = /^(?!-)[\w./~^@{}+-]{1,200}$/

/** A path of the repository as git writes it: relative, `/`-separated, never above it. */
function relPath(v: unknown): string {
  if (typeof v !== 'string' || v === '' || v.startsWith('/') || /^[A-Za-z]:/.test(v) || v.split('/').some((p) => p === '..' || p === '')) throw new GitError('invalid')
  return v
}

function hunkOf(v: unknown): (Hunk & { lines?: { before: string[]; after: string[] } }) | null {
  if (v === null || v === undefined) return null
  const h = v as Record<string, unknown>
  const n = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0
  if (!n(h.a) || !n(h.aEnd) || !n(h.b) || !n(h.bEnd)) throw new GitError('invalid')
  const lines = h.lines as { before?: unknown; after?: unknown } | undefined
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string')
  return {
    a: h.a as number,
    aEnd: h.aEnd as number,
    b: h.b as number,
    bEnd: h.bEnd as number,
    ...(lines && strings(lines.before) && strings(lines.after) ? { lines: { before: lines.before, after: lines.after } } : {}),
  }
}

export function registerReview(deps: ReviewDeps): void {
  const store = new ReviewStore(deps.dir)
  let git: ReviewGit | null = null
  const need = async (): Promise<ReviewGit> => {
    if (git) return git
    const bin = await deps.systemGit()
    if (!bin) throw new GitError('no-git')
    return (git = new ReviewGit(bin))
  }

  /** A repository folio may read: the folder itself is one (a worktree too). */
  const repo = async (v: unknown): Promise<string> => {
    if (typeof v !== 'string') throw new GitError('invalid')
    const root = await deps.repoOf(v)
    if (!root || resolve(root) !== resolve(v)) throw new GitError('invalid')
    return root
  }

  const specOf = async (v: unknown): Promise<Exclude<ChangeSpec, { kind: 'since' }>> => {
    const s = (v ?? {}) as Record<string, unknown>
    const rev = (x: unknown) => {
      if (typeof x !== 'string' || !REV.test(x)) throw new GitError('invalid')
      return x
    }
    switch (s.kind) {
      case 'working':
        return { kind: 'working', repo: await repo(s.repo) }
      case 'commit':
        return { kind: 'commit', repo: await repo(s.repo), oid: rev(s.oid) }
      case 'range':
        return { kind: 'range', repo: await repo(s.repo), from: rev(s.from), to: rev(s.to) }
      case 'worktree':
        return { kind: 'worktree', path: await repo(s.path), base: rev(s.base) }
      default:
        throw new GitError('invalid')
    }
  }

  const handle = (channel: string, fn: (...args: unknown[]) => Promise<unknown>) =>
    ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
      try {
        return await fn(...args)
      } catch (e) {
        if (e instanceof GitError) return { error: e.code, detail: e.detail }
        return { error: 'failed', detail: [e instanceof Error ? e.message : String(e)] }
      }
    })

  handle('review:available', async () => ({ ok: true, available: (await deps.systemGit()) !== null }))

  /** A set since the last look: its repository, or null for another kind. */
  const sinceOf = async (v: unknown): Promise<string | null> => {
    const s = (v ?? {}) as Record<string, unknown>
    return s.kind === 'since' ? repo(s.repo) : null
  }

  handle('review:changeset', async (spec) => {
    const g = await need()
    const since = await sinceOf(spec)
    if (since) return { ok: true, set: await g.since(since, store.checkpoint(since)) }
    return { ok: true, set: await g.changeset(await specOf(spec)) }
  })

  // Since the last look (R3): the checkpoint taken — of everything, or of one file seen.
  handle('review:checkpoint', async (path) => {
    const root = await repo(path)
    store.setCheckpoint(root, await (await need()).snapshot(root))
    deps.changed(root)
    return { ok: true }
  })
  handle('review:checkpoint-file', async (path, file) => {
    const g = await need()
    const root = await repo(path)
    const rel = relPath(file)
    const cp = store.checkpoint(root) ?? { ...(await g.snapshot(root, [])), files: {} }
    const disk = join(root, ...rel.split('/'))
    cp.files[rel] = existsSync(disk) ? readFileSync(disk, 'utf8') : null
    store.setCheckpoint(root, cp)
    return { ok: true }
  })
  /** How many files changed since the last look; null before the first look. */
  handle('review:since-count', async (path) => {
    const root = await repo(path)
    const cp = store.checkpoint(root)
    if (!cp) return { ok: true, count: null }
    return { ok: true, count: (await (await need()).since(root, cp)).files.length }
  })

  handle('review:texts', async (spec, file) => {
    const g = await need()
    const f = (file ?? {}) as Partial<ChangedFile>
    const path = relPath(f.path)
    const since = await sinceOf(spec)
    if (since) return { ok: true, texts: await g.sinceTexts(since, store.checkpoint(since), path) }
    const s = await specOf(spec)
    const sides = await g.sidesOf(s)
    const status = typeof f.status === 'string' ? f.status : 'modified'
    return { ok: true, texts: await g.texts({ spec: s, ...sides }, { path, oldPath: f.oldPath ? relPath(f.oldPath) : undefined, status, binary: f.binary === true }) }
  })

  handle('review:act', async (spec, action, path, hunk) => {
    const g = await need()
    const s = await specOf(spec)
    if (s.kind !== 'working' || (action !== 'stage' && action !== 'unstage' && action !== 'discard')) throw new GitError('invalid')
    const rel = relPath(path)
    const run = hunkOf(hunk)
    const t = deps.text()
    try {
      if (action === 'discard' && !run) {
        if (!(await deps.confirm(t.discardFileQuestion.replace('{name}', rel), t.discardFileDetail, t.discard))) return { ok: false }
        const known = (await g.textAt(s.repo, 'HEAD', rel)) !== null
        await g.act(s.repo, 'discard', rel, null)
        // New to git: the file itself goes to the trash.
        const file = join(s.repo, ...rel.split('/'))
        if (!known && existsSync(file)) await deps.trash(file)
      } else await g.act(s.repo, action, rel, run)
      return { ok: true }
    } finally {
      deps.changed(s.repo)
    }
  })

  handle('review:viewed', async (path) => {
    const r = store.of(await repo(path))
    return { ok: true, viewed: r.viewed, comments: r.comments }
  })
  handle('review:comment-save', async (path, comment) => {
    const c = commentOf(comment)
    if (!c) throw new GitError('invalid')
    relPath(c.path)
    store.saveComment(await repo(path), c)
    return { ok: true }
  })
  const ids = (v: unknown): string[] => {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new GitError('invalid')
    return v as string[]
  }
  handle('review:comment-delete', async (path, list) => {
    store.deleteComments(await repo(path), ids(list))
    return { ok: true }
  })
  handle('review:comment-sent', async (path, list) => {
    store.markSent(await repo(path), ids(list))
    return { ok: true }
  })
  handle('review:set-viewed', async (path, key, hash) => {
    if (typeof key !== 'string' || key.length > 2000 || (hash !== null && typeof hash !== 'string')) throw new GitError('invalid')
    store.setViewed(await repo(path), key, hash as string | null)
    return { ok: true }
  })

  handle('review:worktrees', async (path, base) => {
    const g = await need()
    // Any folder of the repository: its worktrees are the repository's.
    const root = typeof path === 'string' ? await deps.repoOf(path) : null
    if (!root) throw new GitError('invalid')
    const list = await g.worktrees(root, null)
    const main = list.find((w) => w.main)?.path ?? root
    const b = typeof base === 'string' && REV.test(base) ? base : ((await g.currentBranch(main)) ?? 'HEAD')
    return { ok: true, base: b, main, list: await g.worktrees(main, b) }
  })

  handle('review:worktree-project', async (main, path) => {
    const g = await need()
    const root = await repo(main)
    const listed = await g.worktrees(root, null)
    const wt = listed.find((w) => resolve(w.path) === resolve(String(path)))
    if (!wt) throw new GitError('invalid')
    return { ok: true, workspace: deps.addProject(wt.path) }
  })

  handle('review:worktree-remove', async (main, path, branch, changed) => {
    const g = await need()
    const root = await repo(main)
    const wt = await repo(path)
    const t = deps.text()
    const detail = typeof changed === 'number' && changed > 0 ? t.removeWorktreeDirty.replace('{n}', String(changed)) : t.removeWorktreeDetail
    if (!(await deps.confirm(t.removeWorktreeQuestion.replace('{name}', wt), detail, t.remove))) return { ok: false }
    try {
      await g.removeWorktree(root, wt, true, typeof branch === 'string' && REV.test(branch) ? branch : null)
    } finally {
      deps.changed(root)
    }
    return { ok: true, workspace: deps.forgetProject(wt) }
  })

  handle('review:worktree-merge', async (main, branch) => {
    const g = await need()
    const root = await repo(main)
    if (typeof branch !== 'string' || !REV.test(branch)) throw new GitError('invalid')
    try {
      await g.mergeBranch(root, branch)
    } finally {
      deps.changed(root)
    }
    return { ok: true }
  })

  handle('review:worktree-take', async (main, path, base) => {
    const g = await need()
    const root = await repo(main)
    const wt = await repo(path)
    if (typeof base !== 'string' || !REV.test(base)) throw new GitError('invalid')
    try {
      await g.takeChanges(root, wt, base)
    } finally {
      deps.changed(root)
    }
    return { ok: true }
  })
}
