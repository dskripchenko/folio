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
}

export interface Changeset {
  spec: ChangeSpec
  /** The folder git runs in: the repository or the worktree. */
  root: string
  /** What the files are compared with, and what with: revisions, or `disk`. */
  before: string
  after: string | 'disk'
  files: ChangedFile[]
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

/** Whether the review may change files of a set: only where the "after" side is the disk. */
export function editable(spec: ChangeSpec): boolean {
  return spec.kind === 'working' || spec.kind === 'worktree' || spec.kind === 'since'
}

/** The folder of a set. */
export function rootOf(spec: ChangeSpec): string {
  return spec.kind === 'worktree' ? spec.path : spec.repo
}
