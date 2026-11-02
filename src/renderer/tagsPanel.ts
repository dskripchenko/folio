/**
 * The tags of the project in view, beside the page: every tag with the number
 * of its notes, nested ones under their parents (`work/urgent` under `work`),
 * a filter by name; a tag opened shows its notes, a click opens one. A tag
 * clicked in a document opens the panel on it.
 */
import { icon, iconButton } from './icons'

export interface TagsText {
  title: string
  close: string
  filter: string
  none: string
  noTags: string
}

export interface TagEntry {
  tag: string
  notes: { rel: string; path: string }[]
}

export class TagsPanel {
  readonly el: HTMLElement
  private readonly input: HTMLInputElement
  private readonly list: HTMLElement
  private entries: TagEntry[] = []
  private note: string | null = null
  private readonly open = new Set<string>()
  private seq = 0

  constructor(
    private text: TagsText,
    private readonly load: (note: string | null) => Promise<TagEntry[]>,
    private readonly openNote: (path: string) => void,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'tags-panel'
    this.el.dataset.testid = 'tags-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'tags-title'
    const close = iconButton('close', text.close, () => this.setVisible(false))
    close.dataset.testid = 'tags-close'
    header.append(title, close)
    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.className = 'tags-filter'
    this.input.dataset.testid = 'tags-filter'
    this.input.addEventListener('input', () => this.draw())
    this.list = document.createElement('div')
    this.list.className = 'tags-list'
    this.el.append(header, this.input, this.list)
    this.setText(text)
  }

  setText(text: TagsText): void {
    this.text = text
    this.el.querySelector('.tags-title')!.textContent = text.title
    this.input.placeholder = text.filter
    this.draw()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    this.onVisibility(on)
    if (on) void this.refresh()
  }

  /** The note in view: its project's tags are listed. */
  show(note: string | null): void {
    if (note === this.note) return
    this.note = note
    void this.refresh()
  }

  /** A tag clicked in a document: the panel opens on it, its parents opened, its notes shown. */
  reveal(tag: string): void {
    const parts = tag.split('/')
    for (let k = 1; k <= parts.length; k++) this.open.add(parts.slice(0, k).join('/').toLowerCase())
    this.input.value = ''
    if (this.el.hidden) this.setVisible(true)
    else void this.refresh()
    requestAnimationFrame(() => this.list.querySelector<HTMLElement>(`[data-tag="${CSS.escape(tag.toLowerCase())}"]`)?.scrollIntoView({ block: 'nearest' }))
  }

  async refresh(): Promise<void> {
    if (this.el.hidden) return
    const seq = ++this.seq
    const entries = await this.load(this.note)
    if (seq !== this.seq) return
    this.entries = entries
    this.draw()
  }

  private draw(): void {
    const filter = this.input.value.trim().toLowerCase().replace(/^#/, '')
    const shown = (filter === '' ? this.entries : this.entries.filter((e) => e.tag.toLowerCase().includes(filter))).slice().sort(byPath)
    if (shown.length === 0) {
      const p = document.createElement('p')
      p.className = 'tags-none'
      p.textContent = this.entries.length === 0 ? this.text.noTags : this.text.none
      this.list.replaceChildren(p)
      return
    }
    // Filtered: a flat list of matches; otherwise a tree, children under their parent.
    this.list.replaceChildren(...shown.filter((e) => filter !== '' || !e.tag.includes('/') || this.parentOpen(e.tag)).map((e) => this.row(e, filter === '' ? e.tag.split('/').length - 1 : 0)))
  }

  private parentOpen(tag: string): boolean {
    const parts = tag.split('/')
    for (let k = 1; k < parts.length; k++) if (!this.open.has(parts.slice(0, k).join('/').toLowerCase())) return false
    return true
  }

  private row(entry: TagEntry, depth: number): HTMLElement {
    const key = entry.tag.toLowerCase()
    const box = document.createElement('div')
    box.className = 'tags-item'
    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'tags-row'
    head.dataset.tag = key
    head.dataset.testid = 'tags-row'
    head.style.paddingLeft = `${10 + depth * 14}px`
    const expanded = this.open.has(key)
    head.setAttribute('aria-expanded', String(expanded))
    const name = document.createElement('span')
    name.className = 'tags-name'
    name.textContent = `#${depth > 0 ? entry.tag.split('/').pop() : entry.tag}`
    const count = document.createElement('span')
    count.className = 'tags-count'
    count.textContent = String(entry.notes.length)
    head.append(icon('chevron', 12), name, count)
    head.addEventListener('click', () => {
      if (this.open.has(key)) this.open.delete(key)
      else this.open.add(key)
      this.draw()
    })
    box.append(head)
    if (expanded) {
      const notes = document.createElement('ul')
      notes.className = 'tags-notes'
      for (const n of entry.notes) {
        const li = document.createElement('li')
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'tags-note'
        b.dataset.testid = 'tags-note'
        b.style.paddingLeft = `${26 + depth * 14}px`
        b.title = n.rel
        b.append(icon('note', 13), n.rel.split('/').pop()!.replace(/\.(md|markdown)$/i, ''))
        b.addEventListener('click', () => this.openNote(n.path))
        li.append(b)
        notes.append(li)
      }
      box.append(notes)
    }
    return box
  }
}

/** Tags in tree order: by their parts, so a child follows its parent (`work`, `work/urgent`, `work-a`). */
function byPath(a: TagEntry, b: TagEntry): number {
  const x = a.tag.toLowerCase().split('/')
  const y = b.tag.toLowerCase().split('/')
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i]!.localeCompare(y[i]!)
    if (c !== 0) return c
  }
  return x.length - y.length
}
