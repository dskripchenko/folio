/**
 * What the review shows (ADR-006): a set of changes — the working copy, a
 * commit, a range of commits, a worktree against its base, or what changed
 * since it was last looked at — and the files in it.
 */
export type ChangeSpec =
  | { kind: 'working'; repo: string }
  | { kind: 'commit'; repo: string; oid: string }
  | { kind: 'range'; repo: string; from: string; to: string }
  | { kind: 'worktree'; path: string; base: string }
  | { kind: 'since'; repo: string }

export type FileChange = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange'

export interface ChangedFile {
  /** `/`-separated, from the repository's (or worktree's) root. */
  path: string
  /** Where it was before a rename or copy. */
  oldPath?: string
  status: FileChange
  binary: boolean
  /** Lines added and removed (0 for a binary file). */
  add: number
  del: number
  /** Not known to git yet (working copy, worktree). */
  untracked?: boolean
  /** When the file on disk last changed (ms), for a set against the disk. */
  mtime?: number
}

export interface Changeset {
  spec: ChangeSpec
  /** The folder git runs in: the repository or the worktree. */
  root: string
  /** What the files are compared with, and what with: revisions, or `disk`. */
  before: string
  after: string | 'disk'
  files: ChangedFile[]
  /** A commit's first line. */
  subject?: string
}

/** A file's two texts (null: none there); too big or binary ones are not read. */
export interface FileTexts {
  before: string | null
  after: string | null
  /** The index's text (the working copy only), for telling staged runs. */
  index?: string | null
  binary?: boolean
  tooBig?: boolean
}

export interface Worktree {
  path: string
  /** The main working copy (the first one git lists). */
  main: boolean
  head: string | null
  /** The branch's short name; null when detached. */
  branch: string | null
  locked: boolean
  prunable: boolean
  /** Files changed and not committed. */
  changed: number
  /** Commits ahead of the base and behind it. */
  ahead: number
  behind: number
  /** Milliseconds: the last commit or the newest changed file. */
  lastActivity: number
}

export type ReviewAction = 'stage' | 'unstage' | 'discard'

/**
 * A comment on a line (ADR-006, R5): found again by the lines it was made on
 * (the line and a couple before it), so a line moved keeps its comment; one
 * whose lines are gone is shown as out of date.
 */
export interface ReviewComment {
  id: string
  path: string
  /** The side: the text before (a removed line) or after. */
  side: 'a' | 'b'
  /** 1-based, where it was made. */
  line: number
  /** The line and up to two before it, as they read then. */
  excerpt: string[]
  /** The rows around it as the review showed them (`+`, `-`, ` ` first): what the agent is sent. */
  context: string[]
  text: string
  time: number
  sent?: boolean
}

/** A comment as stored, or null when it is not one. */
export function commentOf(v: unknown): ReviewComment | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Record<string, unknown>
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.length <= 40 && x.every((s) => typeof s === 'string' && s.length < 2000)
  if (typeof c.id !== 'string' || !/^[\w-]{1,64}$/.test(c.id) || typeof c.path !== 'string' || c.path === '' || (c.side !== 'a' && c.side !== 'b')) return null
  if (typeof c.line !== 'number' || !Number.isInteger(c.line) || c.line < 1 || !strings(c.excerpt) || !strings(c.context) || typeof c.text !== 'string' || c.text.length > 20000) return null
  return { id: c.id, path: c.path, side: c.side, line: c.line, excerpt: c.excerpt, context: c.context, text: c.text, time: typeof c.time === 'number' ? c.time : Date.now(), ...(c.sent === true ? { sent: true } : {}) }
}

/** Whether the review may change files of a set: only where the "after" side is the disk. */
export function editable(spec: ChangeSpec): boolean {
  return spec.kind === 'working' || spec.kind === 'worktree' || spec.kind === 'since'
}

/** The folder of a set. */
export function rootOf(spec: ChangeSpec): string {
  return spec.kind === 'worktree' ? spec.path : spec.repo
}

/** An edit an agent reported (R6, Claude Code's hook). */
export interface AgentEdit {
  /** Absolute. */
  path: string
  session: string
  tool: string
  /** The folder the agent worked in (a worktree's, for a subagent there). */
  cwd: string
  /** Milliseconds. */
  time: number
  /** From the repository asked about, when the file is in it. */
  rel?: string
}

/** The comments as one text for an agent: each with its file and line, the rows it is about, and what to do. */
export function compose(intro: string, comments: readonly ReviewComment[]): string {
  const parts = [intro, '']
  comments.forEach((c, i) => {
    parts.push(`${i + 1}. ${c.path}:${c.line}${c.side === 'a' ? ' (removed line)' : ''}`)
    if (c.context.length) parts.push('```diff', ...c.context, '```')
    parts.push(...c.text.trim().split('\n'), '')
  })
  return parts.join('\n').trimEnd() + '\n'
}
