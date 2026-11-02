/** What the preload offers the window (see src/preload/preload.ts). */
/** How a document is drawn and edited (stage 5). */
export type Format = 'markdown' | 'bpmn' | 'dmn' | 'drawio' | 'openapi' | 'asyncapi' | 'diagram' | 'text'

/** A place in a note, as the links panel shows it. */
export interface LinkPlace {
  line: number
  preview: string
  start: number
  end: number
  index: number
  length: number
  display: string
  nth: number
}

export interface LinksData {
  /** How a link names this note. */
  name: string
  outgoing: (LinkPlace & { target: string | null; raw: string; wiki: boolean; path: string | null })[]
  incoming: { rel: string; path: string; places: LinkPlace[] }[]
  mentions: { rel: string; path: string; places: LinkPlace[] }[]
}

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
  kind?: 'markdown' | 'diagram' | 'code' | 'other'
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
  /** Files kept at hand; `missing` when moved away outside folio or deleted. */
  bookmarks: { path: string; name: string; missing: boolean }[]
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
  /** View → Commands (Cmd+K). */
  onPalette: Listener
  onFind: Listener
  onGoToFile: Listener
  onToggleConsole: Listener
  onConsoleHere: Listener
  openConsole(cwd: string | null, cols: number, rows: number): Promise<{ id: number; cwd: string } | { error: string }>
  consoleInput(id: number, data: string): void
  consoleResize(id: number, cols: number, rows: number): void
  closeConsole(id: number): void
  resolveConsolePath(cwd: string, text: string): Promise<{ path: string; line: number | null; column: number | null } | null>
  onConsoleData(callback: (id: number, data: string) => void): () => void
  onConsoleExit(callback: (id: number, code: number) => void): () => void
  searchScopes(): Promise<{ root: string; label: string | null }[]>
  search(id: number, query: string, options: Record<string, boolean>, scope: string): Promise<{ files: number; matches: number; truncated: boolean; canceled: boolean } | { error: string }>
  cancelSearch(): void
  replace(query: string, options: Record<string, boolean>, replacement: string, files: string[]): Promise<{ files: number; replacements: number; commits: number } | { error: string }>
  onSearchHits(callback: (id: number, batch: unknown) => void): () => void
  allFiles(): Promise<{ root: string; label: string | null; path: string; kind: 'markdown' | 'diagram' | 'code' | 'other' }[]>
  onPrint: Listener
  exportPdf(target: object, options: Record<string, unknown>): Promise<{ saved: string } | { canceled: true } | { error: string }>
  onExportPdf: Listener
  onExportFile: Listener
  onExportFolder: Listener
  allowNetwork(scope: 'file' | 'folder', path: string): Promise<boolean>
  workspace(): Promise<WorkspaceView>
  addProject(): Promise<WorkspaceView>
  updateProject(id: string, changes: Record<string, unknown>): Promise<WorkspaceView>
  setShared(reset: boolean): Promise<WorkspaceView>
  projectMenu(id: string): void
  list(root: string, rel: string, all: boolean): Promise<Entry[] | null>
  openEntry(root: string, rel: string): Promise<OpenResult>
  onTreeCreate: Listener
  onTreeRename: Listener
  onFsMoved: Listener
  onFsRemoved: Listener
  fsTrash(root: string, rel: string): Promise<void>
  fsCreate(root: string, dir: string, name: string, kind: 'note' | 'folder'): Promise<{ path: string; rel: string } | { error: string }>
  fsRename(root: string, rel: string, name: string): Promise<{ from: string; to: string } | { error: string }>
  fsMove(fromRoot: string, fromRel: string, toRoot: string, toDir: string): Promise<{ from: string; to: string } | { error: string }>
  /** Which of a note's `[[link]]` targets reach a file. */
  wikiExists(from: string, targets: string[]): Promise<boolean[]>
  /** Open the file a `[[link]]` names, making the note when it is not there yet; `heading` to scroll to. */
  wikiOpen(from: string, target: string): Promise<OpenResult & { heading?: string | null; created?: boolean }>
  /** The files a note can link to, by the name a link would use. */
  wikiNames(from: string): Promise<{ name: string; path: string }[]>
  /** After a move: links to it written anew in the root's notes; how many notes changed. */
  wikiMoved(from: string, to: string, skip: string[]): Promise<number>
  /** A picture pasted into a note, saved in `attachments/` beside it: its path for the Markdown. */
  saveImage(note: string, name: string, type: string, bytes: Uint8Array): Promise<{ path: string } | { error: string }>
  /** A note's links panel: its links, the notes linking to it, the ones naming it without a link. */
  wikiPanel(note: string, text: string): Promise<LinksData | null>
  /** The tags of the notes in a note's root (Shared without one), each with its notes. */
  tagIndex(note: string | null): Promise<{ tag: string; notes: { rel: string; path: string }[] }[]>
  /** The notes of a note's root and the links between them (indexes into `nodes`). */
  graph(note: string | null): Promise<{ nodes: { rel: string; path: string; name: string }[]; edges: [number, number][] }>
  /** Today's daily note (made when missing), or the one before / after a daily note's day. */
  dailyOpen(from: string | null, step: 0 | -1 | 1): Promise<OpenResult>
  templates(): Promise<{ name: string; path: string }[]>
  /** A template's text, its fields filled. */
  fillTemplate(path: string, title: string): Promise<string | null>
  folders(): Promise<{ daily: string; templates: string }>
  chooseFolder(kind: 'daily' | 'templates'): Promise<string | null>
  /** The note a link reaches, read without opening it: for a preview. Null for no note. */
  peek(from: string | null, link: { wiki?: string; url?: string }): Promise<{ path: string; name: string; text: string; base: string; heading: string | null } | null>
  /** A mention made a link; false when the note's text has changed meanwhile. */
  linkMention(file: string, index: number, length: number, link: string): Promise<boolean>
  entryMenu(root: string, rel: string): void
  onWorkspace: Listener
  /** A file kept at hand in the bookmarks, or let go: the workspace as it is now. */
  bookmark(path: string, on: boolean): Promise<WorkspaceView>
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
