/**
 * Presenting a note: its slides are the parts between `---` lines (a `---`
 * after an empty line, outside code and front matter, as in Marp and
 * reveal.js), shown one at a time over the whole screen, a 16:9 frame scaled
 * to fit. The arrows, Space, Page Up/Down, Home/End or a click on a half go
 * through them; Escape ends the show.
 */
import { iconButton } from './icons'

export interface SlidesText {
  close: string
  pdf: string
  counter: string
}

/** A note's slides, in order; empty ones left out. */
export function slidesOf(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let start = 0
  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, k) => k > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(l))
    if (end > 0) start = end + 1
  }
  const slides: string[] = []
  let current: string[] = []
  let fence: string | null = null
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (fence === null) fence = f[1]![0]!.repeat(f[1]!.length)
      else if (line.trim().startsWith(fence)) fence = null
    }
    // After text, `---` underlines a heading: a break only after an empty line.
    if (fence === null && /^ {0,3}---[ \t]*$/.test(line) && (current.length === 0 || current[current.length - 1]!.trim() === '')) {
      slides.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  slides.push(current.join('\n'))
  return slides.map((s) => s.trim()).filter((s) => s !== '')
}

/** The frame's size before scaling: the slides are laid out at it, then fitted to the screen. */
const WIDTH = 1280
const HEIGHT = 720

export class Presentation {
  readonly el: HTMLElement
  private readonly frame: HTMLElement
  private readonly counter: HTMLElement
  private at = 0
  private readonly onKey = (e: KeyboardEvent): void => this.key(e)
  private readonly onResize = (): void => this.fit()
  private readonly onFullscreen = (): void => {
    if (!document.fullscreenElement) this.close()
  }

  constructor(
    private readonly text: SlidesText,
    private readonly slides: string[],
    private readonly draw: (slide: string) => HTMLElement,
    private readonly exportPdf: () => void,
    private readonly onClose: () => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'slides-show'
    this.el.dataset.testid = 'slides'
    this.el.tabIndex = -1
    this.frame = document.createElement('div')
    this.frame.className = 'slide-frame'
    this.frame.style.width = `${WIDTH}px`
    this.frame.style.height = `${HEIGHT}px`
    const bar = document.createElement('div')
    bar.className = 'slides-bar'
    this.counter = document.createElement('span')
    this.counter.className = 'slides-counter'
    this.counter.dataset.testid = 'slides-counter'
    bar.append(this.counter, iconButton('pdf', text.pdf, () => this.exportPdf(), 'slides-pdf'), iconButton('close', text.close, () => this.close(), 'slides-close'))
    this.el.append(this.frame, bar)
    // A click on the left half goes back, on the right half forward; not on a link or a control.
    this.el.addEventListener('click', (e) => {
      const target = e.target as Element
      if (target.closest('a, button, input, .slides-bar')) return
      this.go(e.clientX < window.innerWidth / 2 ? this.at - 1 : this.at + 1)
    })
  }

  open(at = 0): void {
    document.body.append(this.el)
    document.addEventListener('keydown', this.onKey, true)
    window.addEventListener('resize', this.onResize)
    this.go(at)
    // The whole screen where it is allowed; the show works in the window too.
    void this.el
      .requestFullscreen?.()
      .then(() => document.addEventListener('fullscreenchange', this.onFullscreen))
      .catch(() => undefined)
    this.el.focus()
  }

  close(): void {
    if (!this.el.isConnected) return
    document.removeEventListener('keydown', this.onKey, true)
    document.removeEventListener('fullscreenchange', this.onFullscreen)
    window.removeEventListener('resize', this.onResize)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    this.el.remove()
    this.onClose()
  }

  get index(): number {
    return this.at
  }

  go(n: number): void {
    this.at = Math.max(0, Math.min(this.slides.length - 1, n))
    const slide = document.createElement('div')
    slide.className = 'slide'
    slide.append(this.draw(this.slides[this.at] ?? ''))
    this.frame.replaceChildren(slide)
    this.counter.textContent = this.text.counter.replace('{n}', String(this.at + 1)).replace('{total}', String(this.slides.length))
    this.fit()
  }

  private fit(): void {
    const scale = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT)
    this.frame.style.transform = `translate(-50%, -50%) scale(${scale})`
  }

  private key(e: KeyboardEvent): void {
    const keys: Record<string, () => void> = {
      ArrowRight: () => this.go(this.at + 1),
      ArrowDown: () => this.go(this.at + 1),
      PageDown: () => this.go(this.at + 1),
      ' ': () => this.go(this.at + (e.shiftKey ? -1 : 1)),
      ArrowLeft: () => this.go(this.at - 1),
      ArrowUp: () => this.go(this.at - 1),
      PageUp: () => this.go(this.at - 1),
      Home: () => this.go(0),
      End: () => this.go(this.slides.length - 1),
      Escape: () => this.close(),
    }
    const act = keys[e.key]
    if (!act || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    act()
  }
}
