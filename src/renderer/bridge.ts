/** What the preload offers the window (see src/preload/preload.ts). */
export interface Opened {
  path: string
  name: string
  text: string
  base: string
  folder: string
  owner: 'shared' | 'project' | 'file'
  project: string | null
}
export type OpenResult = Opened | { error: string; path: string }

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
  startup(): Promise<{ documents: OpenResult[]; active: string | null; locale: string }>
  openDialog(): Promise<OpenResult[]>
  open(path: string): Promise<OpenResult>
  openUrl(url: string): Promise<OpenResult>
  external(url: string): void
  pathOf(file: File): string
  state(documents: string[], active: string | null): void
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
    DskEmbed?: { configure(options: Record<string, unknown>): void }
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
