/**
 * A note's preview while the pointer rests on a link to it: half a second on
 * a `[[link]]` or a link to a note, and the note shows in a panel by the link
 * — drawn as when read, at the heading the link names. The pointer may move
 * into the panel to scroll it; a click there opens the note; leaving it, or
 * Escape, closes it. In the editor the preview waits for ⌘ / Ctrl.
 */

export interface Peeked {
  path: string
  name: string
  text: string
  base: string
  heading: string | null
}

export interface HoverPreviewDeps {
  /** The note a link reaches, read without opening it. */
  peek(from: string | null, link: { wiki?: string; url?: string }): Promise<Peeked | null>
  /** The note drawn as when read. */
  draw(note: Peeked): HTMLElement
  /** Scroll the drawn note to a heading. */
  reveal(container: HTMLElement, heading: string, scroller: HTMLElement): void
  open(note: Peeked): void
  /** The note a link sits in (its links resolve from there). */
  fromOf(link: HTMLAnchorElement): string | null
}

const DELAY = 500
const LEAVE = 250

export class HoverPreview {
  readonly el: HTMLElement
  private shownFor: HTMLAnchorElement | null = null
  private pending: ReturnType<typeof setTimeout> | null = null
  private leaving: ReturnType<typeof setTimeout> | null = null
  private note: Peeked | null = null
  private seq = 0

  constructor(private readonly deps: HoverPreviewDeps) {
    this.el = document.createElement('div')
    this.el.className = 'hover-preview'
    this.el.dataset.testid = 'hover-preview'
    this.el.hidden = true
    this.el.addEventListener('mouseenter', () => this.stay())
    this.el.addEventListener('mouseleave', () => this.leaveSoon())
    this.el.addEventListener('click', (e) => {
      e.preventDefault()
      if (this.note) this.deps.open(this.note)
      this.hide()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.hide()
    })
  }

  /** Watch an area's links. */
  attach(area: HTMLElement): void {
    area.addEventListener('mouseover', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
      if (!a || a === this.shownFor) return
      const link = linkOf(a)
      if (!link) return
      // In the editor a link is text being written: the preview only with ⌘ / Ctrl.
      if (a.closest('[contenteditable="true"]') && !(e.metaKey || e.ctrlKey)) return
      this.cancel()
      this.pending = setTimeout(() => void this.show(a, link), DELAY)
    })
    area.addEventListener('mouseout', (e) => {
      const a = (e.target as HTMLElement).closest('a[href]')
      if (!a) return
      if (this.pending) clearTimeout(this.pending)
      this.pending = null
      if (a === this.shownFor) this.leaveSoon()
    })
  }

  hide(): void {
    this.cancel()
    this.el.hidden = true
    this.el.replaceChildren()
    this.shownFor = null
    this.note = null
  }

  private async show(a: HTMLAnchorElement, link: { wiki?: string; url?: string }): Promise<void> {
    this.pending = null
    const seq = ++this.seq
    const note = await this.deps.peek(this.deps.fromOf(a), link)
    if (seq !== this.seq || !note || !a.isConnected) return
    this.note = note
    this.shownFor = a
    const body = document.createElement('div')
    body.className = 'hover-preview-body'
    body.append(this.deps.draw(note))
    this.el.replaceChildren(body)
    this.el.hidden = false
    this.place(a)
    if (note.heading) this.deps.reveal(body, note.heading, this.el)
  }

  /** Below the link, or above it when there is no room; within the window. */
  private place(a: HTMLElement): void {
    const r = a.getBoundingClientRect()
    const width = Math.min(560, window.innerWidth - 24)
    const height = Math.min(380, window.innerHeight - 24)
    const below = window.innerHeight - r.bottom - 8 >= height || r.top < height + 8
    this.el.style.width = `${width}px`
    this.el.style.maxHeight = `${height}px`
    this.el.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`
    this.el.style.top = below ? `${Math.min(r.bottom + 6, window.innerHeight - height - 12)}px` : `${Math.max(12, r.top - 6 - Math.min(height, this.el.scrollHeight))}px`
  }

  private stay(): void {
    if (this.leaving) clearTimeout(this.leaving)
    this.leaving = null
  }

  private leaveSoon(): void {
    if (this.leaving) clearTimeout(this.leaving)
    this.leaving = setTimeout(() => this.hide(), LEAVE)
  }

  private cancel(): void {
    if (this.pending) clearTimeout(this.pending)
    if (this.leaving) clearTimeout(this.leaving)
    this.pending = null
    this.leaving = null
    this.seq++
  }
}

/** What a link names, when it may be a note: an internal link, or a link into a folder folio reads. */
function linkOf(a: HTMLAnchorElement): { wiki?: string; url?: string } | null {
  if (a.dataset.wikilink !== undefined) return a.dataset.wikilink.startsWith('#') ? null : { wiki: a.dataset.wikilink }
  return a.href.startsWith('folio://app/r/') ? { url: a.href } : null
}
