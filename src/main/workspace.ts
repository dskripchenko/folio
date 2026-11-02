import { mkdirSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJson, writeJson } from './jsonFile'
import { isInside, realish } from './paths'

/**
 * The workspace (ADR-001): "Shared" — one folder for common documents — and
 * the projects, any folders on disk added to folio. The list lives in
 * folio-data/workspace.json; the folders stay where they are.
 */
export interface Project {
  id: string
  name: string
  path: string
  group?: string
  pinned?: boolean
  hidden?: boolean
  /** Commit a saved file of this folder to its git history (ADR-001, stage 4). */
  autoCommit?: boolean
}

export interface WorkspaceData {
  version: 1
  /** The shared folder; null — folio-data/library. */
  shared: string | null
  /** Commit saved files of Shared to its history. */
  sharedAutoCommit?: boolean
  projects: Project[]
  /** Where daily notes go, and where templates are; null — `Daily` and `Templates` in Shared. */
  dailyFolder?: string | null
  templatesFolder?: string | null
  /** Files kept at hand, by their paths, in the order they were added. */
  bookmarks?: string[]
  /** Spelling checked as text is written; unset — on where the system checks it (macOS, Windows). */
  spellcheck?: boolean
  /** A new version looked for once a day at start; unset — on. */
  updates?: boolean
}

export class Workspace {
  private data: WorkspaceData

  constructor(private readonly dataDir: string) {
    const loaded = readJson<Partial<WorkspaceData>>(this.file(), {})
    this.data = {
      version: 1,
      shared: loaded.shared ?? null,
      ...(loaded.sharedAutoCommit !== undefined ? { sharedAutoCommit: loaded.sharedAutoCommit } : {}),
      ...(loaded.dailyFolder ? { dailyFolder: loaded.dailyFolder } : {}),
      ...(loaded.templatesFolder ? { templatesFolder: loaded.templatesFolder } : {}),
      ...(typeof loaded.spellcheck === 'boolean' ? { spellcheck: loaded.spellcheck } : {}),
      ...(typeof loaded.updates === 'boolean' ? { updates: loaded.updates } : {}),
      ...(Array.isArray(loaded.bookmarks) ? { bookmarks: loaded.bookmarks.filter((b): b is string => typeof b === 'string') } : {}),
      projects: Array.isArray(loaded.projects) ? loaded.projects : [],
    }
  }

  private file(): string {
    return join(this.dataDir, 'workspace.json')
  }

  private save(): void {
    writeJson(this.file(), this.data)
  }

  /** The shared folder, created when it is the default one. */
  shared(): string {
    if (this.data.shared) return this.data.shared
    const dir = join(this.dataDir, 'library')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  setShared(path: string | null): void {
    this.data.shared = path === null ? null : resolve(path)
    this.save()
  }

  /** The daily notes' folder (not made here: a daily note makes it). */
  dailyFolder(): string {
    return this.data.dailyFolder ?? join(this.shared(), 'Daily')
  }

  setDailyFolder(path: string | null): void {
    this.data.dailyFolder = path === null ? null : resolve(path)
    this.save()
  }

  /**
   * Whether spelling is checked. The system checks it on macOS and Windows,
   * offline; elsewhere Chromium fetches dictionaries from the web, so it is off
   * until it is turned on.
   */
  spellcheck(platform = process.platform): boolean {
    return this.data.spellcheck ?? (platform === 'darwin' || platform === 'win32')
  }

  setSpellcheck(on: boolean): void {
    this.data.spellcheck = on
    this.save()
  }

  updates(): boolean {
    return this.data.updates ?? true
  }

  setUpdates(on: boolean): void {
    this.data.updates = on
    this.save()
  }

  bookmarks(): string[] {
    return [...(this.data.bookmarks ?? [])]
  }

  /** A file kept at hand, or let go. */
  setBookmark(path: string, on: boolean): void {
    const list = (this.data.bookmarks ?? []).filter((b) => b !== resolve(path))
    if (on) list.push(resolve(path))
    this.data.bookmarks = list
    this.save()
  }

  /** A file or folder moved: the bookmarks of it and of what is in it follow; whether any did. */
  moveBookmarks(from: string, to: string): boolean {
    const list = this.data.bookmarks ?? []
    if (!list.some((b) => b === from || b.startsWith(from + sep))) return false
    this.data.bookmarks = list.map((b) => (b === from ? to : b.startsWith(from + sep) ? to + b.slice(from.length) : b))
    this.save()
    return true
  }

  /** The templates' folder. */
  templatesFolder(): string {
    return this.data.templatesFolder ?? join(this.shared(), 'Templates')
  }

  setTemplatesFolder(path: string | null): void {
    this.data.templatesFolder = path === null ? null : resolve(path)
    this.save()
  }

  sharedAutoCommit(): boolean {
    return this.data.sharedAutoCommit === true
  }

  setSharedAutoCommit(on: boolean): void {
    this.data.sharedAutoCommit = on
    this.save()
  }

  /** Whether a saved file is committed: its folder (project or Shared) says so. */
  autoCommits(file: string): boolean {
    const owner = this.ownerOf(file)
    if (owner?.kind === 'project') return owner.project.autoCommit === true
    if (owner?.kind === 'shared') return this.sharedAutoCommit()
    return false
  }

  projects(): Project[] {
    return this.data.projects.map((p) => ({ ...p }))
  }

  addProject(path: string, name?: string): Project {
    const full = resolve(path)
    const existing = this.data.projects.find((p) => resolve(p.path) === full)
    if (existing) return { ...existing }
    const project: Project = { id: randomUUID(), name: name ?? basename(full), path: full }
    this.data.projects.push(project)
    this.save()
    return { ...project }
  }

  updateProject(id: string, changes: Partial<Omit<Project, 'id' | 'path'>>): void {
    const project = this.data.projects.find((p) => p.id === id)
    if (!project) return
    Object.assign(project, changes)
    this.save()
  }

  removeProject(id: string): void {
    this.data.projects = this.data.projects.filter((p) => p.id !== id)
    this.save()
  }

  /** Where a file belongs: the innermost project holding it, else Shared, else nothing. */
  ownerOf(file: string): { kind: 'project'; project: Project } | { kind: 'shared' } | null {
    // Compared by real paths: a project added as /var/x holds /private/var/x/a.md.
    const target = realish(file)
    const inside = (dir: string) => isInside(realish(dir), target)
    const holding = this.data.projects.filter((p) => inside(p.path)).sort((a, b) => b.path.length - a.path.length)
    if (holding[0]) return { kind: 'project', project: { ...holding[0] } }
    if (inside(this.shared())) return { kind: 'shared' }
    return null
  }
}
