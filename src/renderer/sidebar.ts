/**
 * The sidebar: Shared and the projects (pinned first, then by group), each a
 * lazily listed tree of the files folio can open. Expanded folders are
 * remembered; changes on disk list the affected folders again.
 *
 * Collapsed, it is a narrow rail — Shared and each project as an initial —
 * and a click slides that tree out over the page (the flyout), until a file
 * is opened or the click goes elsewhere.
 */
import { folio, prefs, type Changes, type Entry, type ProjectView, type WorkspaceView } from './bridge'
import { icon, iconButton, type IconName } from './icons'
import { closeMenu, popMenu } from './menu'

export interface SidebarText {
  shared: string
  projects: string
  addProject: string
  addFolder: string
  cloneRepo: string
  sharedMenu: string
  projectsMenu: string
  chooseShared: string
  resetShared: string
  showHidden: string
  noProjects: string
  missing: string
  empty: string
  ungrouped: string
  openFile: string
  newNote: string
  collapse: string
  expand: string
}

interface Options {
  el: HTMLElement
  /** The collapsed sidebar, and the tree it slides out. */
  rail: HTMLElement
  flyout: HTMLElement
  text: () => SidebarText
  open: (root: string, rel: string) => void
  clone: () => void
  openFile: () => void
  newNote: () => void
}

const FILE_ICON: Record<string, IconName> = { markdown: 'file', diagram: 'diagram' }

export class Sidebar {
  private ws: WorkspaceView | null = null
  /** What the flyout shows: Shared, or a project by id. */
  private flown: string | null = null
  private expanded = new Set<string>(prefs.get<string[]>('expanded', []))
  private showHidden = prefs.get<boolean>('showHidden', false)
  private activeFile: string | null = null
  private readonly sep: string

  constructor(private readonly o: Options) {
    this.sep = folio().platform === 'win32' ? '\\' : '/'
    folio().onWorkspace((value) => this.render(value as WorkspaceView))
    folio().onFsChanged((value) => void this.changed(value as Changes[]))
    folio().onEdit((value) => this.edit(value as { id: string; field: 'name' | 'group' }))
    document.body.classList.toggle('sidebar-collapsed', prefs.get('sidebarCollapsed', false))
    // The flyout goes when the click is elsewhere, or with Escape.
    document.addEventListener('mousedown', (e) => {
      const t = e.target as Node
      if (this.flown && !this.o.flyout.contains(t) && !this.o.rail.contains(t) && !(t as Element).closest?.('.pop-menu')) this.closeFlyout()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.flown) this.closeFlyout()
    })
  }

  get collapsed(): boolean {
    return document.body.classList.contains('sidebar-collapsed')
  }

  toggleCollapsed(): void {
    const on = !this.collapsed
    document.body.classList.toggle('sidebar-collapsed', on)
    prefs.set('sidebarCollapsed', on)
    this.closeFlyout()
    if (this.ws) this.render(this.ws)
  }

  /** Where the trees are: the sidebar, and the flyout of the collapsed one. */
  private containers(): HTMLElement[] {
    return [this.o.el, this.o.flyout]
  }

  async load(): Promise<void> {
    this.render(await folio().workspace())
  }

  async addProject(): Promise<void> {
    this.render(await folio().addProject())
  }

  /** Mark the open document in the tree. */
  setActive(path: string | null): void {
    this.activeFile = path
    for (const c of this.containers()) {
      for (const row of c.querySelectorAll<HTMLElement>('.row[data-abs]')) row.classList.toggle('active', row.dataset.abs === path)
    }
  }

  private key(root: string, rel: string): string {
    return `${root}:${rel}`
  }

  private saveExpanded(): void {
    prefs.set('expanded', [...this.expanded])
  }

  private abs(rootPath: string, rel: string): string {
    return rel === '' ? rootPath : rootPath + this.sep + rel.split('/').join(this.sep)
  }

  render(ws: WorkspaceView): void {
    this.ws = ws
    const t = this.o.text()
    const el = this.o.el
    el.replaceChildren()
    this.renderRail(ws)
    if (this.flown) this.openFlyout(this.flown)

    // What is done from here: open a file, a quick note, fold the sidebar away.
    const head = document.createElement('div')
    head.className = 'side-head'
    const title = document.createElement('span')
    title.className = 'side-title'
    title.textContent = 'folio'
    const tools = document.createElement('div')
    tools.className = 'side-tools'
    tools.append(
      iconButton('open', t.openFile, () => this.o.openFile(), 'side-open'),
      iconButton('note', t.newNote, () => this.o.newNote(), 'side-new-note'),
      iconButton('collapse', t.collapse, () => this.toggleCollapsed(), 'side-collapse'),
    )
    head.append(title, tools)
    el.append(head)

    // Shared
    const shared = this.section('shared', t.shared, [
      iconButton('more', t.sharedMenu, (e) =>
        popMenu(e.currentTarget as HTMLElement, [
          { label: t.chooseShared, icon: 'folder', action: () => void folio().setShared(false).then((v) => this.render(v)) },
          { label: t.resetShared, icon: 'shared', action: () => void folio().setShared(true).then((v) => this.render(v)) },
        ], 'end'),
      'shared-menu'),
    ])
    shared.dataset.testid = 'shared'
    shared.append(this.tree(ws.shared.root, ws.shared.path, ''))
    el.append(shared)

    // Projects: adding one (a folder, a clone) and what is shown.
    const projects = this.section('projects', t.projects, [
      iconButton('plus', t.addProject, (e) =>
        popMenu(e.currentTarget as HTMLElement, [
          { label: t.addFolder, icon: 'folderPlus', testid: 'add-folder', action: () => void this.addProject() },
          { label: t.cloneRepo, icon: 'clone', testid: 'clone-repo', action: () => this.o.clone() },
        ], 'end'),
      'add-project'),
      ...(ws.projects.some((p) => p.hidden)
        ? [iconButton('more', t.projectsMenu, (e) =>
            popMenu(e.currentTarget as HTMLElement, [
              { label: t.showHidden, checked: this.showHidden, testid: 'show-hidden', action: () => {
                this.showHidden = !this.showHidden
                prefs.set('showHidden', this.showHidden)
                this.render(ws)
              } },
            ], 'end'),
          'projects-menu')]
        : []),
    ])
    projects.dataset.testid = 'projects'
    const visible = ws.projects.filter((p) => this.showHidden || !p.hidden)
    if (visible.length === 0) {
      const hint = document.createElement('p')
      hint.className = 'hint'
      hint.textContent = t.noProjects
      projects.append(hint)
    }
    const byName = (a: ProjectView, b: ProjectView) => a.name.localeCompare(b.name, undefined, { numeric: true })
    const pinned = visible.filter((p) => p.pinned).sort(byName)
    const rest = visible.filter((p) => !p.pinned)
    const groups = new Map<string, ProjectView[]>()
    for (const p of rest) {
      const g = p.group ?? ''
      groups.set(g, [...(groups.get(g) ?? []), p])
    }
    for (const p of pinned) projects.append(this.project(p))
    const names = [...groups.keys()].filter((g) => g !== '').sort((a, b) => a.localeCompare(b))
    for (const g of names) {
      const head = document.createElement('div')
      head.className = 'group'
      head.textContent = g
      projects.append(head)
      for (const p of (groups.get(g) ?? []).sort(byName)) projects.append(this.project(p))
    }
    for (const p of (groups.get('') ?? []).sort(byName)) projects.append(this.project(p))
    el.append(projects)
    this.setActive(this.activeFile)
  }

  private section(kind: string, title: string, actions: HTMLElement[]): HTMLElement {
    const s = document.createElement('section')
    s.className = `side-section side-${kind}`
    const h = document.createElement('header')
    const span = document.createElement('span')
    span.className = 'section-title'
    span.textContent = title
    const tools = document.createElement('span')
    tools.className = 'section-tools'
    tools.append(...actions)
    h.append(span, tools)
    s.append(h)
    return s
  }

  /** The collapsed sidebar: expand, Shared, each visible project as its initials, adding a project. */
  private renderRail(ws: WorkspaceView): void {
    const t = this.o.text()
    const rail = this.o.rail
    rail.replaceChildren()
    const item = (key: string, label: string, content: Node, extra = '') => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `rail-item ${extra}`
      b.title = label
      b.setAttribute('aria-label', label)
      b.dataset.key = key
      b.classList.toggle('on', this.flown === key)
      b.append(content)
      b.addEventListener('click', () => (this.flown === key ? this.closeFlyout() : this.openFlyout(key)))
      return b
    }
    const top = document.createElement('div')
    top.className = 'rail-group'
    top.append(iconButton('expand', t.expand, () => this.toggleCollapsed(), 'rail-expand'))
    const items = document.createElement('div')
    items.className = 'rail-group rail-items'
    items.append(item('shared', t.shared, icon('shared', 18), 'rail-shared'))
    for (const p of ws.projects.filter((x) => this.showHidden || !x.hidden)) {
      const badge = document.createElement('span')
      badge.className = 'avatar'
      badge.textContent = initials(p.name)
      badge.style.setProperty('--avatar-hue', String(hue(p.name)))
      items.append(item(p.id, p.name, badge))
    }
    const bottom = document.createElement('div')
    bottom.className = 'rail-group rail-bottom'
    bottom.append(
      iconButton('open', t.openFile, () => this.o.openFile()),
      iconButton('plus', t.addProject, (e) =>
        popMenu(e.currentTarget as HTMLElement, [
          { label: t.addFolder, icon: 'folderPlus', action: () => void this.addProject() },
          { label: t.cloneRepo, icon: 'clone', action: () => this.o.clone() },
        ]),
      ),
    )
    rail.append(top, items, bottom)
  }

  /** Slide a tree out over the page: Shared's, or a project's. */
  openFlyout(key: string): void {
    const ws = this.ws
    if (!ws) return
    const t = this.o.text()
    const project = key === 'shared' ? null : ws.projects.find((p) => p.id === key)
    if (key !== 'shared' && !project) return this.closeFlyout()
    this.flown = key
    const fly = this.o.flyout
    fly.replaceChildren()
    const head = document.createElement('header')
    head.className = 'flyout-head'
    const name = document.createElement('span')
    name.className = 'section-title'
    name.textContent = project ? project.name : t.shared
    head.append(name, iconButton('close', t.collapse, () => this.closeFlyout()))
    fly.append(head)
    const root = project ? project.root : ws.shared.root
    const path = project ? project.path : ws.shared.path
    if (project?.missing) {
      const hint = document.createElement('p')
      hint.className = 'hint'
      hint.textContent = t.missing
      fly.append(hint)
    } else fly.append(this.tree(root, path, ''))
    fly.hidden = false
    for (const b of this.o.rail.querySelectorAll<HTMLElement>('.rail-item')) b.classList.toggle('on', b.dataset.key === key)
  }

  closeFlyout(): void {
    this.flown = null
    this.o.flyout.hidden = true
    this.o.flyout.replaceChildren()
    closeMenu()
    for (const b of this.o.rail.querySelectorAll<HTMLElement>('.rail-item')) b.classList.remove('on')
  }

  private project(p: ProjectView): HTMLElement {
    const t = this.o.text()
    const wrap = document.createElement('div')
    wrap.className = 'project'
    wrap.dataset.project = p.id
    const row = document.createElement('div')
    row.className = 'row project-row'
    row.tabIndex = 0
    row.title = p.path
    const key = this.key(p.root, '')
    const open = this.expanded.has(key)
    const twisty = document.createElement('span')
    twisty.className = 'twisty'
    twisty.append(icon('chevron', 12))
    row.classList.toggle('open', open)
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = p.name
    row.append(twisty, icon('folder', 15), name)
    if (p.pinned) row.classList.add('pinned')
    if (p.hidden) row.classList.add('hidden-project')
    if (p.missing) {
      const m = document.createElement('span')
      m.className = 'badge'
      m.textContent = t.missing
      row.append(m)
    }
    const children = document.createElement('div')
    children.className = 'children'
    const toggle = () => {
      if (this.expanded.has(key)) {
        this.expanded.delete(key)
        children.replaceChildren()
        row.classList.remove('open')
      } else {
        this.expanded.add(key)
        children.replaceChildren(this.tree(p.root, p.path, ''))
        row.classList.add('open')
      }
      this.saveExpanded()
    }
    row.addEventListener('click', toggle)
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      folio().projectMenu(p.id)
    })
    if (open && !p.missing) children.append(this.tree(p.root, p.path, ''))
    wrap.append(row, children)
    return wrap
  }

  /** A folder's list, filled when it arrives. */
  private tree(root: string, rootPath: string, rel: string): HTMLElement {
    const ul = document.createElement('ul')
    ul.className = 'tree'
    ul.dataset.root = root
    ul.dataset.rel = rel
    ul.dataset.rootPath = rootPath
    void this.fill(ul)
    return ul
  }

  private async fill(ul: HTMLElement): Promise<void> {
    const root = ul.dataset.root ?? ''
    const rel = ul.dataset.rel ?? ''
    const rootPath = ul.dataset.rootPath ?? ''
    const entries = (await folio().list(root, rel, false)) ?? []
    ul.replaceChildren()
    if (entries.length === 0 && rel === '') {
      const li = document.createElement('li')
      li.className = 'hint'
      li.textContent = this.o.text().empty
      ul.append(li)
    }
    for (const entry of entries) ul.append(this.entry(root, rootPath, entry))
    this.setActive(this.activeFile)
    void this.decorate(ul)
  }

  /** The git status of a listed folder: changed files, folders holding changes, the branch at the top. */
  private async decorate(ul: HTMLElement): Promise<void> {
    const root = ul.dataset.root ?? ''
    const rel = ul.dataset.rel ?? ''
    const rootPath = ul.dataset.rootPath ?? ''
    const status = await folio().gitStatus(root, rel)
    const files = status?.files ?? {}
    const changed = Object.keys(files)
    for (const row of ul.querySelectorAll<HTMLElement>(':scope > li > .row')) {
      if (row.dataset.abs) {
        const s = files[row.dataset.abs]
        if (s) row.dataset.status = s
        else delete row.dataset.status
      } else if (row.dataset.rel !== undefined) {
        const dir = this.abs(rootPath, row.dataset.rel) + this.sep
        row.classList.toggle('changed', changed.some((p) => p.startsWith(dir)))
      }
    }
    if (rel === '') {
      const head = ul.closest('.project')?.querySelector<HTMLElement>('.project-row') ?? ul.closest('.side-section, .flyout')?.querySelector<HTMLElement>('header')
      let badge = head?.querySelector<HTMLElement>('.branch-badge') ?? null
      if (status?.branch && head) {
        if (!badge) {
          badge = document.createElement('span')
          badge.className = 'branch-badge'
          head.insertBefore(badge, head.querySelector('.section-tools') ?? null)
        }
        const label = document.createElement('span')
        label.textContent = status.branch
        badge.replaceChildren(icon('branch', 11), label)
        badge.title = status.branch
      } else badge?.remove()
    }
  }

  /** Statuses again (after a commit, which the disk watcher does not see). */
  refreshStatus(): void {
    for (const c of this.containers()) for (const ul of c.querySelectorAll<HTMLElement>('ul.tree')) void this.decorate(ul)
  }

  private entry(root: string, rootPath: string, entry: Entry): HTMLElement {
    const li = document.createElement('li')
    const row = document.createElement('div')
    row.className = `row ${entry.type === 'dir' ? 'dir' : `file kind-${entry.kind}`}`
    row.tabIndex = 0
    row.dataset.rel = entry.path
    const twisty = document.createElement('span')
    twisty.className = 'twisty'
    const key = this.key(root, entry.path)
    if (entry.type === 'dir') {
      twisty.append(icon('chevron', 12))
      row.classList.toggle('open', this.expanded.has(key))
    }
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = entry.name
    row.append(twisty, icon(entry.type === 'dir' ? 'folder' : (FILE_ICON[entry.kind ?? 'other'] ?? 'file'), 15), name)
    li.append(row)

    if (entry.type === 'dir') {
      const toggle = () => {
        const sub = li.querySelector(':scope > ul')
        if (sub) {
          sub.remove()
          this.expanded.delete(key)
          row.classList.remove('open')
        } else {
          li.append(this.tree(root, rootPath, entry.path))
          this.expanded.add(key)
          row.classList.add('open')
        }
        this.saveExpanded()
      }
      row.addEventListener('click', toggle)
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggle()
        }
      })
      if (this.expanded.has(key)) li.append(this.tree(root, rootPath, entry.path))
    } else {
      row.dataset.abs = this.abs(rootPath, entry.path)
      const open = () => {
        this.o.open(root, entry.path)
        if (this.flown) this.closeFlyout()
      }
      row.addEventListener('click', open)
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open()
      })
    }
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      folio().entryMenu(root, entry.path)
    })
    return li
  }

  /** Changes on disk: list the affected folders again, where they are shown. */
  private async changed(changes: Changes[]): Promise<void> {
    for (const c of changes) {
      const dirs = new Set(c.dirs)
      for (const box of this.containers()) {
        for (const ul of box.querySelectorAll<HTMLElement>(`ul.tree[data-root="${c.root}"]`)) {
          if (dirs.has(ul.dataset.rel ?? '')) await this.fill(ul)
        }
      }
    }
    // A change anywhere below changes the folders' marks above it.
    this.refreshStatus()
  }

  /** Rename or group a project in place. */
  private edit({ id, field }: { id: string; field: 'name' | 'group' }): void {
    const project = this.ws?.projects.find((p) => p.id === id)
    const row = this.o.el.querySelector<HTMLElement>(`.project[data-project="${id}"] .project-row`)
    if (!project || !row) return
    const input = document.createElement('input')
    input.className = 'inline-edit'
    input.value = field === 'name' ? project.name : (project.group ?? '')
    input.placeholder = field === 'group' ? this.o.text().ungrouped : ''
    const name = row.querySelector('.name')!
    name.replaceWith(input)
    input.focus()
    input.select()
    let done = false
    const finish = async (save: boolean) => {
      if (done) return
      done = true
      this.render(save ? await folio().updateProject(id, { [field]: input.value }) : this.ws!)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void finish(true)
      if (e.key === 'Escape') void finish(false)
    })
    input.addEventListener('blur', () => void finish(true))
    input.addEventListener('click', (e) => e.stopPropagation())
  }
}

/** A project's initials on the rail: the first letters of its first two words. */
export function initials(name: string): string {
  const words = name.split(/[\s_\-.]+/).filter(Boolean)
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

/** A colour of its own for each project, the same every time. */
function hue(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
