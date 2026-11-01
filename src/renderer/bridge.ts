/** What the preload offers the window (see src/preload/preload.ts). */
/** How a document is drawn and edited (stage 5). */
export type Format = 'markdown' | 'bpmn' | 'dmn' | 'drawio' | 'openapi' | 'asyncapi' | 'diagram' | 'text'

export interface Opened {
  path: string
  name: string
  text: string
  format: Format
  base: string
  folder: string
  owner: 'shared' | 'project' | 'file'
  project: string | null
}
export type OpenResult = Opened | { error: string; path: string }

export type EditorMode = 'visual' | 'source' | 'split'

/** An unsaved edit or a quick note, as kept in folio-data/session/buffers. */
export interface BufferData {
  id: string
  path: string | null
  text: string
  baseline: string | null
  mode: EditorMode
  scroll: number
}

export interface RestoredTab {
  doc: OpenResult | null
  buffer: BufferData | null
  conflict: boolean
}

export type SaveResult = { saved: OpenResult; baseline: string } | { conflict: true } | { canceled: true } | { error: string }

export interface GitInfo {
  root: string | null
  branch: string | null
  branches: string[]
  /** The remote's address, if the repository has one. */
  remote: string | null
  /** Commits to send and to receive, as last fetched; null before the remote has the branch. */
  counts: { ahead: number; behind: number } | null
  merging: { conflicts: string[] } | null
  /** How sync reaches the remote: the system's git, or the built-in one (HTTPS with a token). */
  transport: 'system' | 'builtin'
  autoCommit: boolean
  canStart: boolean
  canAutoCommit: boolean
}

/** A git action's refusal: a code the window has words for, and files, a host or git's words. */
export interface GitRefusal {
  error: 'dirty' | 'merging' | 'no-remote' | 'detached' | 'auth' | 'network' | 'invalid' | 'markers' | 'exists' | 'canceled'
  detail: string[]
}

export type SyncOutcome = { ok: true; transport: 'system' | 'builtin'; result: 'up-to-date' | 'pushed' | 'pulled' | 'merged' | 'conflict'; conflicts?: string[] }

export interface Version {
  oid: string
  message: string
  author: string
  email: string
  time: number
  /** Within the list shown: for a file's versions, the versions before it. */
  parents: string[]
  /** Branches and tags on it (`HEAD -> main`, `origin/main`, `tag: v1`). */
  refs: string[]
}

export interface Entry {
  name: string
  path: string
  type: 'dir' | 'file'
  kind?: 'markdown' | 'diagram' | 'other'
}

export interface ProjectView {
  id: string
  name: string
  path: string
  root: string
  group?: string
  pinned?: boolean
  hidden?: boolean
  missing: boolean
}

export interface WorkspaceView {
  shared: { root: string; path: string }
  projects: ProjectView[]
}

export interface Changes {
  root: string
  dirs: string[]
  files: string[]
}

type Listener = (cb: (value: unknown) => void) => () => void

export interface FolioBridge {
  platform: string
  startup(): Promise<{ tabs: RestoredTab[]; active: number | null; locale: string; shared: string }>
  openDialog(): Promise<OpenResult[]>
  open(path: string): Promise<OpenResult>
  openUrl(url: string): Promise<OpenResult>
  external(url: string): void
  pathOf(file: File): string
  state(tabs: { path: string | null; buffer: string | null }[], active: number | null, activePath: string | null): void
  writeBuffer(buffer: BufferData): void
  dropBuffer(id: string): void
  disk(path: string): Promise<{ text: string; hash: string } | null>
  save(path: string, text: string, baseline: string | null, force: boolean): Promise<SaveResult>
  saveAs(text: string, name: string, dir: string | null): Promise<SaveResult>
  confirmClose(name: string): Promise<'save' | 'discard' | 'cancel'>
  gitInfo(path: string): Promise<GitInfo | null>
  gitHistory(path: string, scope: 'file' | 'all'): Promise<Version[]>
  gitTextAt(path: string, oid: string): Promise<string | null>
  gitStart(path: string): Promise<GitInfo | null>
  gitAuto(path: string, on: boolean): Promise<GitInfo | null>
  gitCommit(path: string, message: string): Promise<string | null>
  gitBranchCreate(path: string, name: string): Promise<{ ok: true } | GitRefusal>
  gitBranchSwitch(path: string, name: string): Promise<{ ok: true } | GitRefusal>
  gitRemote(path: string, url: string): Promise<{ ok: true } | GitRefusal>
  gitSync(path: string): Promise<SyncOutcome | GitRefusal>
  gitLogin(path: string, username: string, password: string, remember: boolean): Promise<{ ok: true; saved: boolean } | GitRefusal>
  gitMergeFinish(path: string): Promise<{ ok: true; oid: string } | GitRefusal>
  gitMergeAbort(path: string): Promise<{ ok: true } | GitRefusal>
  gitClone(url: string): Promise<{ ok: true; dir: string } | GitRefusal>
  onClone: Listener
  gitStatus(root: string, rel: string): Promise<{ branch: string | null; files: Record<string, 'new' | 'modified' | 'deleted'> } | null>
  onCommitted: Listener
  onToggleHistory: Listener
  onNewNote: Listener
  onSave: Listener
  onSaveAs: Listener
  onToggleEdit: Listener
  onPrint: Listener
  allowNetwork(scope: 'file' | 'folder', path: string): Promise<boolean>
  workspace(): Promise<WorkspaceView>
  addProject(): Promise<WorkspaceView>
  updateProject(id: string, changes: Record<string, unknown>): Promise<WorkspaceView>
  setShared(reset: boolean): Promise<WorkspaceView>
  projectMenu(id: string): void
  list(root: string, rel: string, all: boolean): Promise<Entry[] | null>
  openEntry(root: string, rel: string): Promise<OpenResult>
  entryMenu(root: string, rel: string): void
  onWorkspace: Listener
  onEdit: Listener
  onFsChanged: Listener
  onAddProject: Listener
  onToggleSidebar: Listener
  onOpened: Listener
  onBlocked: Listener
  onCloseTab: Listener
}

declare global {
  interface Window {
    folio: FolioBridge
    DskEmbed?: { configure(options: Record<string, unknown>): void; print?: { prepare(root?: ParentNode): Promise<() => void> } }
  }
}

export const folio = (): FolioBridge => window.folio

/** Persisted per-window conveniences (the sidebar's width, what is expanded); never anything that must survive. */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`folio:${key}`)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`folio:${key}`, JSON.stringify(value))
    } catch {
      // Storage unavailable: the convenience is lost, nothing else.
    }
  },
}
