/**
 * The outline of the note in view, beside the page: its headings, indented by
 * level, live as it is written. A click goes to the heading — scrolled to when
 * read or edited visually, the caret on its line in the source; the section in
 * view is marked as the page scrolls.
 */
import { iconButton } from './icons'

export interface OutlineText {
  title: string
  close: string
  none: string
}

export interface Heading {
  level: number
  text: string
  /** Its line in the source (from 0). */
  line: number
}

/** A note's headings: `#` lines and underlined ones, outside code and front matter. */
export function headingsOf(text: string): Heading[] {
  const lines = text.split('\n')
  const out: Heading[] = []
  let fence: string | null = null
  let start = 0
  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, k) => k > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(l))
    if (end > 0) start = end + 1
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (fence === null) fence = f[1]![0]!.repeat(f[1]!.length)
      else if (line.trim().startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    const h = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    if (h) {
      out.push({ level: h[1]!.length, text: plain(h[2]!), line: i })
      continue
    }
    const under = /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[i + 1] ?? '')
    if (under && line.trim() !== '' && !/^\s*([-*+]|\d+[.)])\s/.test(line) && !/^ {0,3}>/.test(line)) {
      out.push({ level: under[1]![0] === '=' ? 1 : 2, text: plain(line.trim()), line: i })
      i++
    }
  }
  return out
}

/** A heading's text as read: no emphasis marks, links as their text. */
function plain(text: string): string {
  return text
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .trim()
}

export interface OutlineDeps {
  /** Go to a heading of the note in view (its index among the headings). */
  go(heading: Heading, index: number): void
}

export class OutlinePanel {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private headings: Heading[] = []
  private current = -1

  constructor(
    private text: OutlineText,
    private readonly deps: OutlineDeps,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'outline-panel'
    this.el.dataset.testid = 'outline-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'outline-title'
    const close = iconButton('close', text.close, () => this.setVisible(false))
    header.append(title, close)
    this.list = document.createElement('nav')
    this.list.className = 'outline-list'
    this.el.append(header, this.list)
    this.setText(text)
  }

  setText(text: OutlineText): void {
    this.text = text
    this.el.querySelector('.outline-title')!.textContent = text.title
    this.draw()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    this.onVisibility(on)
  }

  /** The note in view (its text), or none. */
  show(text: string | null): void {
    const next = text === null ? [] : headingsOf(text)
    if (JSON.stringify(next) === JSON.stringify(this.headings)) return
    this.headings = next
    this.draw()
  }

  /** The section in view: the last heading above the top of the page. */
  mark(index: number): void {
    if (index === this.current) return
    this.current = index
    ;[...this.list.children].forEach((b, i) => b.classList.toggle('on', i === index))
  }

  private draw(): void {
    if (this.headings.length === 0) {
      const p = document.createElement('p')
      p.className = 'outline-none'
      p.textContent = this.text.none
      this.list.replaceChildren(p)
      return
    }
    const top = Math.min(...this.headings.map((h) => h.level))
    this.list.replaceChildren(
      ...this.headings.map((h, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'outline-item'
        b.dataset.testid = 'outline-item'
        b.style.paddingLeft = `${12 + (h.level - top) * 14}px`
        b.textContent = h.text
        b.classList.toggle('on', i === this.current)
        b.addEventListener('click', () => this.deps.go(h, i))
        return b
      }),
    )
  }
}
