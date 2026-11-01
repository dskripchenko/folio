/**
 * The sidebar: Shared and the projects (pinned first, then by group), each a
 * lazily listed tree of the files folio can open. Expanded folders are
 * remembered; changes on disk list the affected folders again.
 */
import { folio, prefs, type Changes, type Entry, type ProjectView, type WorkspaceView } from './bridge'

export interface SidebarText {
  shared: string
  projects: string
  addProject: string
  chooseShared: string
  showHidden: string
  noProjects: string
  missing: string
  empty: string
  ungrouped: string
}

interface Options {
  el: HTMLElement
  text: () => SidebarText
  open: (root: string, rel: string) => void
}

const ICON: Record<string, string> = { dir: '▸', markdown: '◧', diagram: '◇', other: '·' }

export class Sidebar {
  private ws: WorkspaceView | null = null
  private expanded = new Set<string>(prefs.get<string[]>('expanded', []))
  private showHidden = prefs.get<boolean>('showHidden', false)
  private activeFile: string | null = null
  private readonly sep: string

  constructor(private readonly o: Options) {
    this.sep = folio().platform === 'win32' ? '\\' : '/'
    folio().onWorkspace((value) => this.render(value as WorkspaceView))
    folio().onFsChanged((value) => void this.changed(value as Changes[]))
    folio().onEdit((value) => this.edit(value as { id: string; field: 'name' | 'group' }))
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
    for (const row of this.o.el.querySelectorAll<HTMLElement>('.row[data-abs]')) {
      row.classList.toggle('active', row.dataset.abs === path)
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

    // Shared
    const shared = this.section(t.shared, [
      this.iconButton('⋯', t.chooseShared, () => void folio().setShared(false).then((v) => this.render(v))),
    ])
    shared.dataset.testid = 'shared'
    shared.append(this.tree(ws.shared.root, ws.shared.path, ''))
    el.append(shared)

    // Projects
    const projects = this.section(t.projects, [this.iconButton('+', t.addProject, () => void this.addProject())])
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

    if (ws.projects.some((p) => p.hidden)) {
      const toggle = document.createElement('label')
      toggle.className = 'show-hidden'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = this.showHidden
      box.addEventListener('change', () => {
        this.showHidden = box.checked
        prefs.set('showHidden', this.showHidden)
        this.render(ws)
      })
      toggle.append(box, ' ', t.showHidden)
      projects.append(toggle)
    }
    el.append(projects)
    this.setActive(this.activeFile)
  }

  private section(title: string, actions: HTMLElement[]): HTMLElement {
    const s = document.createElement('section')
    s.className = 'side-section'
    const h = document.createElement('header')
    const span = document.createElement('span')
    span.textContent = title
    h.append(span, ...actions)
    s.append(h)
    return s
  }

  private iconButton(label: string, title: string, click: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'icon'
    b.textContent = label
    b.title = title
    b.setAttribute('aria-label', title)
    b.addEventListener('click', click)
    return b
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
    twisty.textContent = open ? '▾' : '▸'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = p.name
    row.append(twisty, name)
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
        twisty.textContent = '▸'
      } else {
        this.expanded.add(key)
        children.replaceChildren(this.tree(p.root, p.path, ''))
        twisty.textContent = '▾'
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
  }

  private entry(root: string, rootPath: string, entry: Entry): HTMLElement {
    const li = document.createElement('li')
    const row = document.createElement('div')
    row.className = `row ${entry.type === 'dir' ? 'dir' : `file kind-${entry.kind}`}`
    row.tabIndex = 0
    row.dataset.rel = entry.path
    const icon = document.createElement('span')
    icon.className = 'twisty'
    const key = this.key(root, entry.path)
    icon.textContent = entry.type === 'dir' ? (this.expanded.has(key) ? '▾' : '▸') : (ICON[entry.kind ?? 'other'] ?? '·')
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = entry.name
    row.append(icon, name)
    li.append(row)

    if (entry.type === 'dir') {
      const toggle = () => {
        const sub = li.querySelector(':scope > ul')
        if (sub) {
          sub.remove()
          this.expanded.delete(key)
          icon.textContent = '▸'
        } else {
          li.append(this.tree(root, rootPath, entry.path))
          this.expanded.add(key)
          icon.textContent = '▾'
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
      const open = () => this.o.open(root, entry.path)
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
      for (const ul of this.o.el.querySelectorAll<HTMLElement>(`ul.tree[data-root="${c.root}"]`)) {
        if (dirs.has(ul.dataset.rel ?? '')) await this.fill(ul)
      }
    }
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
