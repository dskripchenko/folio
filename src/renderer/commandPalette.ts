/**
 * Every action of folio by its name (Cmd+K, F1): a palette over the window,
 * ranked as the name is typed; the ones used lately first. Each command shows
 * its keys; one that cannot run now (no document open) is not offered.
 */
import { rank } from './fuzzy'
import { icon, type IconName } from './icons'

export interface PaletteText {
  placeholder: string
  none: string
}

export interface Command {
  id: string
  title: string
  /** The group it is in, shown before the title (`File`, `View`…). */
  group: string
  /** The keys, as shown (`⌘S`). */
  keys?: string
  icon?: IconName
  /** Whether it can run now; offered only then. */
  when?: () => boolean
  run: () => void
}

const RECENT_KEY = 'folio.commands.recent'
const RECENT = 8

export class CommandPalette {
  readonly el: HTMLElement
  private readonly input: HTMLInputElement
  private readonly list: HTMLElement
  private shown: Command[] = []
  private selected = 0
  private returnFocus: Element | null = null

  constructor(
    private text: PaletteText,
    private readonly commands: () => Command[],
  ) {
    this.el = document.createElement('div')
    this.el.className = 'palette-backdrop'
    this.el.dataset.testid = 'command-palette'
    this.el.hidden = true
    const box = document.createElement('div')
    box.className = 'palette'
    box.setAttribute('role', 'dialog')
    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.spellcheck = false
    this.input.dataset.testid = 'command-input'
    this.input.setAttribute('role', 'combobox')
    this.input.setAttribute('aria-expanded', 'true')
    this.input.setAttribute('aria-controls', 'command-list')
    this.list = document.createElement('ul')
    this.list.id = 'command-list'
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

  setText(text: PaletteText): void {
    this.text = text
    this.input.placeholder = text.placeholder
    this.input.setAttribute('aria-label', text.placeholder)
  }

  get isOpen(): boolean {
    return !this.el.hidden
  }

  open(): void {
    if (!this.el.hidden) return this.input.select()
    this.returnFocus = document.activeElement
    this.el.hidden = false
    this.pointer = null
    this.input.value = ''
    this.input.focus()
    this.filter()
  }

  close(): void {
    if (this.el.hidden) return
    this.el.hidden = true
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus()
  }

  private available(): Command[] {
    const all = this.commands().filter((c) => !c.when || c.when())
    const recent = recentIds()
    const order = (c: Command): number => {
      const i = recent.indexOf(c.id)
      return i < 0 ? RECENT : i
    }
    // Lately used first, the rest as listed.
    return all.map((c, i) => ({ c, i })).sort((a, b) => order(a.c) - order(b.c) || a.i - b.i).map(({ c }) => c)
  }

  private filter(): void {
    const all = this.available()
    const query = this.input.value.trim()
    const ranked = query === '' ? all.map((item) => ({ item, match: { score: 0, positions: [] as number[] } })) : rank(query, all, (c) => `${c.group}: ${c.title}`, 100)
    this.shown = ranked.map((r) => r.item)
    this.selected = 0
    if (ranked.length === 0) {
      const li = document.createElement('li')
      li.className = 'palette-note'
      li.textContent = this.text.none
      this.list.replaceChildren(li)
      return
    }
    this.list.replaceChildren(
      ...ranked.map(({ item, match }, i) => {
        const marked = new Set(match.positions)
        const full = `${item.group}: ${item.title}`
        const li = document.createElement('li')
        li.className = 'palette-item command-item'
        li.setAttribute('role', 'option')
        li.dataset.testid = 'command-item'
        li.dataset.command = item.id
        const group = document.createElement('span')
        group.className = 'command-group'
        group.append(...marks(full, 0, item.group.length, marked))
        const name = document.createElement('span')
        name.className = 'palette-name'
        name.append(...marks(full, item.group.length + 2, full.length, marked))
        li.append(icon(item.icon ?? 'chevron'), group, name)
        if (item.keys) {
          const keys = document.createElement('kbd')
          keys.className = 'command-keys'
          keys.textContent = item.keys
          li.append(keys)
        }
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
    const command = this.shown[index]
    if (!command) return
    remember(command.id)
    this.close()
    command.run()
  }
}

function recentIds(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, RECENT)))
  } catch {
    // Not kept: the order is as listed next time.
  }
}

/** A piece of the text with the matched characters in `<b>`. */
function marks(text: string, from: number, to: number, marked: Set<number>): Node[] {
  const out: Node[] = []
  for (let i = from; i < to; i++) {
    const ch = text[i]!
    if (marked.has(i)) out.push(Object.assign(document.createElement('b'), { textContent: ch }))
    else if (out.length > 0 && out[out.length - 1] instanceof Text) (out[out.length - 1] as Text).appendData(ch)
    else out.push(document.createTextNode(ch))
  }
  return out
}
