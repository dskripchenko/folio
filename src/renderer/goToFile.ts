/**
 * Going to a file by its name (Cmd+T): a palette over the window with every
 * file of Shared and the projects, ranked as the name is typed — characters
 * in order, not necessarily together. Arrows choose, Enter opens, Escape
 * leaves.
 */
import { rank } from './fuzzy'
import { icon, type IconName } from './icons'

export interface GoToFileText {
  placeholder: string
  shared: string
  none: string
  loading: string
}

export interface IndexedFile {
  root: string
  label: string | null
  path: string
  kind: 'markdown' | 'diagram' | 'code' | 'other'
}

const KIND_ICON: Record<IndexedFile['kind'], IconName> = { markdown: 'file', diagram: 'diagram', code: 'source', other: 'file' }

/** How many rows the palette shows. */
const ROWS = 50

export class GoToFile {
  readonly el: HTMLElement
  private readonly input: HTMLInputElement
  private readonly list: HTMLElement
  private files: IndexedFile[] = []
  private shown: IndexedFile[] = []
  private selected = 0
  private returnFocus: Element | null = null

  constructor(
    private text: GoToFileText,
    private readonly load: () => Promise<IndexedFile[]>,
    private readonly openFile: (file: IndexedFile) => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'palette-backdrop'
    this.el.dataset.testid = 'go-to-file'
    this.el.hidden = true
    const box = document.createElement('div')
    box.className = 'palette'
    box.setAttribute('role', 'dialog')
    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.spellcheck = false
    this.input.dataset.testid = 'go-to-file-input'
    this.input.setAttribute('role', 'combobox')
    this.input.setAttribute('aria-expanded', 'true')
    this.input.setAttribute('aria-controls', 'palette-list')
    this.list = document.createElement('ul')
    this.list.id = 'palette-list'
    this.list.className = 'palette-list'
    this.list.setAttribute('role', 'listbox')
    box.append(this.input, this.list)
    this.el.append(box)
    this.setText(text)

    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close()
    })
    this.input.addEventListener('input', () => this.filter())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (this.shown.length === 0) return
        this.selected = (this.selected + (e.key === 'ArrowDown' ? 1 : -1) + this.shown.length) % this.shown.length
        this.mark()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        this.choose(this.selected)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
      }
    })
  }

  setText(text: GoToFileText): void {
    this.text = text
    this.input.placeholder = text.placeholder
    this.input.setAttribute('aria-label', text.placeholder)
  }

  get isOpen(): boolean {
    return !this.el.hidden
  }

  async open(): Promise<void> {
    if (!this.el.hidden) return this.input.select()
    this.returnFocus = document.activeElement
    this.el.hidden = false
    this.pointer = null
    this.input.value = ''
    this.input.focus()
    this.list.replaceChildren(this.note(this.text.loading))
    // Asked each time: the index follows the disk, and is kept between times in the main process.
    this.files = await this.load()
    if (!this.el.hidden) this.filter()
  }

  close(): void {
    if (this.el.hidden) return
    this.el.hidden = true
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus()
  }

  private display(f: IndexedFile): string {
    return `${f.label ?? this.text.shared}/${f.path}`
  }

  private filter(): void {
    const query = this.input.value
    const ranked =
      query.trim() === ''
        ? this.files.slice(0, ROWS).map((item) => ({ item, match: { score: 0, positions: [] as number[] } }))
        : rank(query, this.files, (f) => this.display(f), ROWS)
    this.shown = ranked.map((r) => r.item)
    this.selected = 0
    if (ranked.length === 0) {
      this.list.replaceChildren(this.note(this.text.none))
      return
    }
    this.list.replaceChildren(
      ...ranked.map(({ item, match }, i) => {
        const full = this.display(item)
        const nameStart = full.lastIndexOf('/') + 1
        const marked = new Set(match.positions)
        const li = document.createElement('li')
        li.className = 'palette-item'
        li.setAttribute('role', 'option')
        li.dataset.testid = 'go-to-file-item'
        li.dataset.path = item.path
        const name = document.createElement('span')
        name.className = 'palette-name'
        name.append(...highlighted(full, nameStart, full.length, marked))
        const where = document.createElement('span')
        where.className = 'palette-where'
        where.append(...highlighted(full, 0, Math.max(0, nameStart - 1), marked))
        li.append(icon(KIND_ICON[item.kind]), name, where)
        li.addEventListener('mousedown', (e) => {
          e.preventDefault()
          this.choose(i)
        })
        li.addEventListener('mousemove', (e) => {
          // Only a pointer that moves chooses: one resting where the list opens does not.
          if (!this.pointerMoved(e) || this.selected === i) return
          this.selected = i
          this.mark()
        })
        return li
      }),
    )
    this.mark()
  }

  private pointer: { x: number; y: number } | null = null

  /** Whether the pointer has moved since the palette opened (a list drawn under it sends a move too). */
  private pointerMoved(e: MouseEvent): boolean {
    const was = this.pointer
    this.pointer = { x: e.screenX, y: e.screenY }
    return was !== null && (was.x !== e.screenX || was.y !== e.screenY)
  }

  private mark(): void {
    ;[...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.selected)))
    this.list.children[this.selected]?.scrollIntoView({ block: 'nearest' })
  }

  private choose(index: number): void {
    const file = this.shown[index]
    if (!file) return
    this.returnFocus = null
    this.close()
    this.openFile(file)
  }

  private note(text: string): HTMLElement {
    const li = document.createElement('li')
    li.className = 'palette-note'
    li.textContent = text
    return li
  }
}

/** A piece of the text with the matched characters in `<b>`. */
function highlighted(text: string, from: number, to: number, marked: Set<number>): Node[] {
  const out: Node[] = []
  let run = ''
  let bold = false
  for (let i = from; i < to; i++) {
    const m = marked.has(i)
    if (m !== bold && run) {
      out.push(bold ? Object.assign(document.createElement('b'), { textContent: run }) : document.createTextNode(run))
      run = ''
    }
    bold = m
    run += text[i]
  }
  if (run) out.push(bold ? Object.assign(document.createElement('b'), { textContent: run }) : document.createTextNode(run))
  return out
}
