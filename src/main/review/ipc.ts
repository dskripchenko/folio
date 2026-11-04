import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Hunk } from '../../common/hunks'
import { answerText, type McpAnswer } from '../../common/mcp'
import { commentOf, compose, type ChangedFile, type ChangeSpec } from '../../common/review'
import { GitError } from '../git'
import { ReviewGit } from './git'
import { compactEvents, hasHook, hookCommand, readEvents, readSettings, settingsFile, withHook, withoutHook, writeSettings } from './hooks'
import type { ToolHandler } from './mcp'
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
  claudeText: () => { connectQuestion: string; connectDetail: string; connect: string }
  /** Asked with the change shown in full (the hook's settings). */
  confirmLong: (message: string, detail: string, yes: string) => Promise<boolean>
  text: () => { discardFileQuestion: string; discardFileDetail: string; discard: string; removeWorktreeQuestion: string; removeWorktreeDetail: string; removeWorktreeDirty: string; remove: string }
  /** An agent's request (R7): the set shown to the person, their answer awaited; ended when the agent goes. */
  ask: (spec: ChangeSpec, message: string, signal: AbortSignal) => Promise<McpAnswer>
  /** A file opened for the person at a line (R7). */
  openFile: (path: string, line: number | null) => Promise<boolean>
  /** folio's MCP server added to Claude Code for a repository, and taken out (R7). */
  mcp: {
    preview: () => string
    add: (repo: string) => Promise<{ ok: boolean; command: string; output: string }>
    remove: (repo: string) => Promise<unknown>
  }
}

/** A path as the disk has it (its folder's, for a file gone). */
function real(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    try {
      return join(realpathSync.native(dirname(path)), basename(path))
    } catch {
      return path
    }
  }
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

/** The review's channels to the window; the tools it gives an agent over MCP (R7). */
export function registerReview(deps: ReviewDeps): Record<string, ToolHandler> {
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

  // Claude Code's edits (R6): a hook in the repository's local settings.
  /** The main copy of a repository (a worktree's: the one git lists first). */
  const mainOf = async (root: string): Promise<string> => (await (await need()).worktrees(root, null)).find((w) => w.main)?.path ?? root

  handle('review:claude-state', async (path) => {
    const root = await mainOf(await repo(path))
    const settings = readSettings(root)
    return { ok: true, repo: root, connected: settings !== null && hasHook(settings), readable: settings !== null }
  })
  handle('review:claude-connect', async (path, on) => {
    const root = await mainOf(await repo(path))
    const settings = readSettings(root)
    if (settings === null) throw new GitError('invalid', [settingsFile(root)])
    const t = deps.claudeText()
    const command = hookCommand(store.eventsFile(root))
    if (on === true) {
      const detail = t.connectDetail.replace('{file}', settingsFile(root)).replace('{command}', command).replace('{mcp}', deps.mcp.preview())
      if (!(await deps.confirmLong(t.connectQuestion, detail, t.connect))) return { ok: false }
      mkdirSync(dirname(store.eventsFile(root)), { recursive: true })
      writeSettings(root, withHook(settings, command))
      // The server added too: an old entry (an older folio's place) taken out first.
      await deps.mcp.remove(root)
      return { ok: true, mcp: await deps.mcp.add(root) }
    }
    writeSettings(root, withoutHook(settings))
    await deps.mcp.remove(root)
    return { ok: true }
  })
  handle('review:agent-edits', async (path) => {
    const asked = await repo(path)
    const root = await mainOf(asked)
    const file = store.eventsFile(root)
    const edits = readEvents(file)
    compactEvents(file, edits)
    // Paths as the disk has them (a temporary folder is /private/var on macOS): the agent's and git's agree.
    const base = real(asked)
    return {
      ok: true,
      edits: edits.slice(-3000).map((e) => {
        const p = real(e.path)
        const rel = relative(base, p)
        return { ...e, path: p, ...(rel && !rel.startsWith('..') && !isAbsolute(rel) ? { rel: rel.split(sep).join('/') } : {}) }
      }),
    }
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

  // An agent's tools (R7): what the review gives an agent over MCP. The repository is any path in it.
  const repoAt = async (v: unknown): Promise<string> => {
    if (typeof v !== 'string' || !isAbsolute(v)) throw new Error('repo: an absolute path in a repository is needed')
    const root = await deps.repoOf(v)
    if (!root) throw new Error(`Not in a git repository: ${v}`)
    return root
  }
  const word = (v: unknown, name: string): string | undefined => {
    if (v === undefined || v === null || v === '') return undefined
    if (typeof v !== 'string' || !REV.test(v)) throw new Error(`${name}: not a revision`)
    return v
  }
  const sorted = <T extends { path: string; line: number }>(list: T[]) => [...list].sort((x, y) => (x.path === y.path ? x.line - y.line : x.path < y.path ? -1 : 1))

  return {
    show_changes: async (args, signal) => {
      const g = await need()
      const root = await repoAt(args.repo)
      const kind = args.kind ?? 'working'
      let spec: ChangeSpec
      if (kind === 'working') spec = { kind, repo: root }
      else if (kind === 'since') spec = { kind, repo: root }
      else if (kind === 'commit') spec = { kind, repo: root, oid: word(args.rev, 'rev') ?? 'HEAD' }
      else if (kind === 'range') {
        const from = word(args.from, 'from')
        if (!from) throw new Error('from: the start of the range is needed')
        spec = { kind, repo: root, from, to: word(args.to, 'to') ?? 'HEAD' }
      } else if (kind === 'worktree') {
        const main = await mainOf(root)
        spec = { kind, path: root, base: word(args.base, 'base') ?? (await g.currentBranch(main)) ?? 'HEAD' }
      } else throw new Error(`kind: one of working, commit, range, worktree, since`)
      // Read once here: a set that cannot be read is said to the agent, not shown empty to the person.
      if (spec.kind !== 'since') await g.changeset(spec)
      const message = typeof args.message === 'string' ? args.message.slice(0, 2000) : ''
      return { text: answerText(await deps.ask(spec, message, signal)) }
    },
    get_review_comments: async (args) => {
      const root = await repoAt(args.repo)
      const all = store.of(root).comments.filter((c) => args.all === true || !c.sent)
      if (!all.length) return { text: 'No comments.' }
      store.markSent(root, all.map((c) => c.id))
      return { text: compose(`Comments on the changes in ${root}:`, sorted(all)) }
    },
    open_file: async (args) => {
      if (typeof args.path !== 'string' || !isAbsolute(args.path) || !existsSync(args.path)) throw new Error('path: an absolute path of a file that is there')
      const line = typeof args.line === 'number' && Number.isInteger(args.line) && args.line > 0 ? args.line : null
      return (await deps.openFile(args.path, line)) ? { text: `Opened ${args.path}${line ? `:${line}` : ''}.` } : { text: `folio could not open ${args.path}.`, error: true }
    },
    list_worktrees: async (args) => {
      const g = await need()
      const root = await repoAt(args.repo)
      const main = await mainOf(root)
      const base = (await g.currentBranch(main)) ?? 'HEAD'
      const list = await g.worktrees(main, base)
      return {
        text: JSON.stringify(
          { base, worktrees: list.map((w) => ({ path: w.path, main: w.main, branch: w.branch, changed: w.changed, ahead: w.ahead, behind: w.behind })) },
          null,
          2,
        ),
      }
    },
  }
}
