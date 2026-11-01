import { mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
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
}

export class Workspace {
  private data: WorkspaceData

  constructor(private readonly dataDir: string) {
    const loaded = readJson<Partial<WorkspaceData>>(this.file(), {})
    this.data = {
      version: 1,
      shared: loaded.shared ?? null,
      ...(loaded.sharedAutoCommit !== undefined ? { sharedAutoCommit: loaded.sharedAutoCommit } : {}),
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
