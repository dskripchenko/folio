/**
 * The links of the note in view, beside the page: the notes linking to it,
 * its own links (a missing one faded), and the notes naming it without a
 * link — each such mention made a link with one click. A click on a line
 * opens the note there.
 */
import type { LinkPlace, LinksData } from './bridge'
import { icon, iconButton } from './icons'

export interface LinksText {
  title: string
  close: string
  incoming: string
  outgoing: string
  mentions: string
  noNote: string
  none: string
  missing: string
  link: string
  linked: string
  changed: string
}

export interface LinksBridge {
  panel(note: string, text: string): Promise<LinksData | null>
  linkMention(file: string, index: number, length: number, link: string): Promise<boolean>
  /** A note open in a tab with changes not saved: its text on disk is not what is seen. */
  isDirty(file: string): boolean
}

export interface LinksActions {
  /** Open a note, landing on what a reader sees of the place (its `nth` among the same text). */
  openAt(path: string, place: LinkPlace): void
  /** Follow a `[[link]]` of the note: to its heading, or making the note it names. */
  follow(from: string, raw: string): void
}

export class LinksPanel {
  readonly el: HTMLElement
  private readonly body: HTMLElement
  private readonly status: HTMLElement
  private note: { path: string; text: () => string } | null = null
  private seq = 0

  constructor(
    private text: LinksText,
    private readonly bridge: LinksBridge,
    private readonly actions: LinksActions,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'links-panel'
    this.el.dataset.testid = 'links-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'links-title'
    const close = iconButton('close', text.close, () => this.setVisible(false))
    close.dataset.testid = 'links-close'
    header.append(title, close)
    this.status = document.createElement('div')
    this.status.className = 'links-status'
    this.body = document.createElement('div')
    this.body.className = 'links-body'
    this.el.append(header, this.status, this.body)
    this.setText(text)
  }

  setText(text: LinksText): void {
    this.text = text
    this.el.querySelector('.links-title')!.textContent = text.title
    void this.refresh()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    this.onVisibility(on)
    if (on) void this.refresh()
  }

  /** The note in view (null: none, or not a note); its text as it is in the tab. */
  show(note: { path: string; text: () => string } | null): void {
    this.note = note
    void this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.el.hidden) return
    const seq = ++this.seq
    const note = this.note
    if (!note) {
      this.status.textContent = this.text.noNote
      this.body.replaceChildren()
      return
    }
    const data = await this.bridge.panel(note.path, note.text())
    if (seq !== this.seq) return
    this.status.textContent = ''
    this.body.replaceChildren()
    if (!data) return
    this.body.append(
      this.section('incoming', this.text.incoming, data.incoming.reduce((n, f) => n + f.places.length, 0), () => data.incoming.map((f) => this.file(f.path, f.rel, f.places, null))),
      this.section('outgoing', this.text.outgoing, data.outgoing.length, () =>
        data.outgoing.map((l) => {
          const row = this.place(l, l.target ?? l.raw, () => (l.wiki ? this.actions.follow(note.path, l.raw) : l.path ? this.actions.openAt(l.path, { ...l, display: '', nth: 0 }) : undefined))
          row.classList.toggle('missing', l.path === null)
          if (l.path === null) row.title = this.text.missing
          return row
        }),
      ),
      this.section('mentions', this.text.mentions, data.mentions.reduce((n, f) => n + f.places.length, 0), () => data.mentions.map((f) => this.file(f.path, f.rel, f.places, data.name))),
    )
  }

  private section(id: string, title: string, count: number, items: () => HTMLElement[]): HTMLElement {
    const box = document.createElement('section')
    box.className = 'links-section'
    box.dataset.testid = `links-${id}`
    const head = document.createElement('h3')
    head.append(title, ' ')
    const n = document.createElement('span')
    n.className = 'links-count'
    n.textContent = String(count)
    head.append(n)
    box.append(head)
    if (count === 0) {
      const none = document.createElement('p')
      none.className = 'links-none'
      none.textContent = this.text.none
      box.append(none)
    } else box.append(...items())
    return box
  }

  /** A note and its places; with `link`, each place can be made a link to the note in view. */
  private file(path: string, rel: string, places: LinkPlace[], link: string | null): HTMLElement {
    const box = document.createElement('div')
    box.className = 'links-file'
    const head = document.createElement('div')
    head.className = 'links-file-head'
    const name = document.createElement('span')
    name.className = 'links-file-name'
    name.textContent = rel.split('/').pop()!.replace(/\.(md|markdown)$/i, '')
    const where = document.createElement('span')
    where.className = 'links-file-where'
    where.textContent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    head.append(icon('note', 14), name, where)
    box.append(head)
    for (const p of places) {
      const row = this.place(p, null, () => this.actions.openAt(path, p))
      if (link !== null) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'links-make'
        b.textContent = this.text.link
        b.dataset.testid = 'links-make'
        b.disabled = this.bridge.isDirty(path)
        b.addEventListener('click', async (e) => {
          e.stopPropagation()
          const ok = await this.bridge.linkMention(path, p.index, p.length, link)
          this.status.textContent = ok ? this.text.linked : this.text.changed
          void this.refresh()
        })
        row.append(b)
      }
      box.append(row)
    }
    return box
  }

  /** A line: its number, the line with the match marked; `label` before it for a note's own links. */
  private place(p: LinkPlace, label: string | null, open: () => void): HTMLElement {
    const row = document.createElement('div')
    row.className = 'links-place'
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    if (label !== null) {
      const to = document.createElement('span')
      to.className = 'links-target'
      // The note's name; its folder in the tooltip.
      to.textContent = label.split('/').pop()!.replace(/\.(md|markdown)$/i, '')
      to.title = label
      row.append(to)
    }
    const line = document.createElement('span')
    line.className = 'links-line'
    line.textContent = String(p.line)
    const preview = document.createElement('span')
    preview.className = 'links-preview'
    const b = document.createElement('b')
    b.textContent = p.preview.slice(p.start, p.end)
    preview.append(p.preview.slice(0, p.start), b, p.preview.slice(p.end))
    row.append(line, preview)
    row.addEventListener('click', open)
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') open()
    })
    return row
  }
}
