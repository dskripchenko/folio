/**
 * Going to a symbol by its name — of the file in view (Cmd/Ctrl+Shift+O) or
 * of every project (Cmd/Ctrl+Alt+O): a palette over the window, ranked as the
 * name is typed, each with what holds it and (across projects) its file.
 */
import { rank } from './fuzzy'

export interface SymbolEntry {
  name: string
  kind: string
  container: string
  /** 0-based. */
  line: number
  column: number
  /** Across projects: the file it is in. */
  file?: { root: string; label: string | null; path: string }
}

export interface SymbolPaletteText {
  file: string
  project: string
  none: string
  loading: string
  shared: string
}

const ROWS = 60

/** A short sign for a kind, before the name. */
const SIGN: Record<string, string> = {
  class: 'C',
  interface: 'I',
  struct: 'S',
  enum: 'E',
  trait: 'T',
  type: 'T',
  function: 'ƒ',
  method: 'm',
  constructor: 'c',
  property: 'p',
  constant: 'K',
  variable: 'v',
  module: 'M',
  namespace: 'N',
  heading: '#',
  key: 'k',
  section: '§',
  selector: '.',
  target: '▸',
  table: '▦',
}

export class SymbolPalette {
  readonly el: HTMLElement
  private readonly input: HTMLInputElement
  private readonly list: HTMLElement
  private items: SymbolEntry[] = []
  private shown: SymbolEntry[] = []
  private selected = 0
  private returnFocus: Element | null = null
  private choose: (s: SymbolEntry) => void = () => {}
  private seq = 0

  constructor(private text: SymbolPaletteText) {
    this.el = document.createElement('div')
    this.el.className = 'palette-backdrop'
    this.el.dataset.testid = 'go-to-symbol'
    this.el.hidden = true
    const box = document.createElement('div')
    box.className = 'palette'
    box.setAttribute('role', 'dialog')
    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.spellcheck = false
    this.input.dataset.testid = 'go-to-symbol-input'
    this.list = document.createElement('ul')
    this.list.className = 'palette-list'
    this.list.setAttribute('role', 'listbox')
    box.append(this.input, this.list)
    this.el.append(box)
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
        this.pick(this.selected)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
      }
    })
  }

  setText(text: SymbolPaletteText): void {
    this.text = text
  }

  get isOpen(): boolean {
    return !this.el.hidden
  }

  /** Opens over the window with the symbols `load` gives (in the file: in its order; across projects: by name). */
  async open(placeholder: string, load: () => Promise<SymbolEntry[]>, choose: (s: SymbolEntry) => void): Promise<void> {
    this.choose = choose
    this.returnFocus = document.activeElement
    this.el.hidden = false
    this.input.value = ''
    this.input.placeholder = placeholder
    this.input.setAttribute('aria-label', this.input.placeholder)
    this.input.focus()
    this.list.replaceChildren(this.note(this.text.loading))
    const seq = ++this.seq
    const items = await load()
    if (seq !== this.seq || this.el.hidden) return
    this.items = items
    this.filter()
  }

  close(): void {
    if (this.el.hidden) return
    this.el.hidden = true
    this.seq++
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus()
  }

  private filter(): void {
    const query = this.input.value.trim()
    const ranked = query === '' ? this.items.slice(0, 500).map((item) => ({ item })) : rank(query, this.items, (s) => s.name, ROWS)
    this.shown = ranked.map((r) => r.item)
    this.selected = 0
    if (this.shown.length === 0) {
      this.list.replaceChildren(this.note(this.text.none))
      return
    }
    this.list.replaceChildren(
      ...this.shown.map((s, i) => {
        const li = document.createElement('li')
        li.className = 'palette-item'
        li.setAttribute('role', 'option')
        li.dataset.testid = 'go-to-symbol-item'
        const sign = document.createElement('span')
        sign.className = `symbol-sign symbol-${s.kind}`
        sign.textContent = SIGN[s.kind] ?? '·'
        sign.title = s.kind
        const name = document.createElement('span')
        name.className = 'palette-name'
        name.textContent = s.name
        const where = document.createElement('span')
        where.className = 'palette-where'
        where.textContent = [s.container, s.file ? `${s.file.label ?? this.text.shared}/${s.file.path}:${s.line + 1}` : `${s.line + 1}`].filter(Boolean).join(' · ')
        li.append(sign, name, where)
        li.addEventListener('mousedown', (e) => {
          e.preventDefault()
          this.pick(i)
        })
        return li
      }),
    )
    this.mark()
  }

  private mark(): void {
    ;[...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.selected)))
    this.list.children[this.selected]?.scrollIntoView({ block: 'nearest' })
  }

  private pick(index: number): void {
    const s = this.shown[index]
    if (!s) return
    this.returnFocus = null
    this.close()
    this.choose(s)
  }

  private note(text: string): HTMLElement {
    const li = document.createElement('li')
    li.className = 'palette-note'
    li.textContent = text
    return li
  }
}
