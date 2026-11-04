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
  /** A picture, a video or a sound (not a note): drawn as itself. */
  media?: 'image' | 'video' | 'audio' | 'svg'
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
  /** The link waited on, for the delay. */
  private waitingFor: HTMLAnchorElement | null = null
  private pending: ReturnType<typeof setTimeout> | null = null
  /** Where the pointer was when it came onto the link. */
  private point = { x: 0, y: 0 }
  private leaving: ReturnType<typeof setTimeout> | null = null
  /** The link whose note is being read (between the wait and the preview). */
  private loading: HTMLAnchorElement | null = null
  private note: Peeked | null = null
  private seq = 0
  /** The pointer's last place (to tell a way from the link into the panel). */
  private pointer = { x: -1, y: -1 }

  constructor(private readonly deps: HoverPreviewDeps) {
    this.el = document.createElement('div')
    this.el.className = 'hover-preview'
    this.el.dataset.testid = 'hover-preview'
    this.el.hidden = true
    // Caught on the way down: a move another handler stops on its way up is still seen.
    window.addEventListener('mousemove', (e) => (this.pointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true })
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
      // The pointer still over the same link (moving over its own parts): the wait goes on.
      // The same link again while its note is read: the read goes on, it is not started over.
      if (!a || a === this.shownFor || a === this.waitingFor || a === this.loading) return
      const link = linkOf(a)
      if (!link) return
      // In the editor a link is text being written: the preview only with ⌘ / Ctrl.
      if (a.closest('[contenteditable="true"]') && !(e.metaKey || e.ctrlKey)) return
      this.cancel()
      this.point = { x: e.clientX, y: e.clientY }
      this.waitingFor = a
      this.pending = setTimeout(() => void this.show(a, link), DELAY)
    })
    area.addEventListener('mouseout', (e) => {
      const a = (e.target as HTMLElement).closest('a[href]')
      // Leaving the link, not moving between its parts.
      if (!a || (e.relatedTarget instanceof Node && a.contains(e.relatedTarget))) return
      if (a === this.waitingFor) {
        if (this.pending) clearTimeout(this.pending)
        this.pending = null
        this.waitingFor = null
      }
      // Left before its note came: no preview for it.
      if (a === this.loading) {
        this.loading = null
        this.seq++
      }
      // The link it was shown for, or that link drawn again (the document redrawn meanwhile).
      if (a === this.shownFor || (this.shownFor && !this.shownFor.isConnected)) this.leaveSoon()
    })
  }

  hide(): void {
    this.cancel()
    this.el.hidden = true
    this.el.replaceChildren()
    this.shownFor = null
    this.note = null
  }

  /** The view scrolled: a shown preview no longer sits by its link. */
  hideShown(): void {
    if (!this.el.hidden) this.hide()
  }

  private async show(a: HTMLAnchorElement, link: { wiki?: string; url?: string }): Promise<void> {
    this.pending = null
    this.waitingFor = null
    const seq = ++this.seq
    this.loading = a
    const note = await this.deps.peek(this.deps.fromOf(a), link)
    if (this.loading === a) this.loading = null
    if (seq !== this.seq || !note) return
    // The document drawn again meanwhile (a slow first draw): the same link, now under the pointer.
    if (!a.isConnected) {
      const again = document.elementFromPoint(this.point.x, this.point.y)?.closest<HTMLAnchorElement>('a[href]')
      const same = again ? linkOf(again) : null
      if (!again || !same || same.wiki !== link.wiki || same.url !== link.url) return
      a = again
    }
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

  /**
   * Below the link, or above it when there is more room there; never over the
   * link itself — a small window makes the panel shorter instead.
   */
  private place(a: HTMLElement): void {
    const r = a.getBoundingClientRect()
    const width = Math.min(560, window.innerWidth - 24)
    const below = window.innerHeight - r.bottom - 6 - 12
    const above = r.top - 6 - 12
    const downward = below >= 380 || below >= above
    this.el.style.width = `${width}px`
    this.el.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`
    this.el.style.maxHeight = `${Math.max(80, Math.min(380, downward ? below : above))}px`
    this.el.style.top = downward ? `${r.bottom + 6}px` : `${r.top - 6 - this.el.offsetHeight}px`
  }

  private stay(): void {
    if (this.leaving) clearTimeout(this.leaving)
    this.leaving = null
  }

  private leaveSoon(): void {
    if (this.leaving) clearTimeout(this.leaving)
    this.leaving = setTimeout(() => {
      this.leaving = null
      // A leave the browser reports while the pointer is still over the preview or its link (content
      // drawn again under a resting pointer): not a leave.
      if (this.el.matches(':hover') || this.shownFor?.matches(':hover')) return
      // On the way from the link into the panel (however slowly): not yet.
      if (this.onTheWay()) return this.leaveSoon()
      this.hide()
    }, LEAVE)
  }

  /**
   * The pointer between the link and the panel: in the band joining the link's
   * edge to the panel's near edge (their convex hull), the way a pointer takes
   * from one into the other.
   */
  private onTheWay(): boolean {
    if (!this.shownFor?.isConnected || this.el.hidden) return false
    const l = this.shownFor.getBoundingClientRect()
    const p = this.el.getBoundingClientRect()
    const below = p.top >= l.bottom - 1
    // The link's edge facing the panel, and the panel's edge facing the link.
    const ly = below ? l.bottom : l.top
    const py = below ? p.top : p.bottom
    const quad: [number, number][] = [
      [l.left, ly],
      [l.right, ly],
      [p.right, py],
      [p.left, py],
    ]
    return insideConvex(quad, this.pointer.x, this.pointer.y)
  }

  private cancel(): void {
    if (this.pending) clearTimeout(this.pending)
    if (this.leaving) clearTimeout(this.leaving)
    this.pending = null
    this.leaving = null
    this.waitingFor = null
    this.loading = null
    this.seq++
  }
}

/** What a link names, when it may be a note: an internal link, or a link into a folder folio reads. */
function linkOf(a: HTMLAnchorElement): { wiki?: string; url?: string } | null {
  if (a.dataset.wikilink !== undefined) return a.dataset.wikilink.startsWith('#') ? null : { wiki: a.dataset.wikilink }
  return a.href.startsWith('folio://app/r/') ? { url: a.href } : null
}

/** A point in a convex polygon (or on its edge), its corners in order either way round. */
export function insideConvex(corners: readonly [number, number][], x: number, y: number): boolean {
  let sign = 0
  for (let i = 0; i < corners.length; i++) {
    const [ax, ay] = corners[i]!
    const [bx, by] = corners[(i + 1) % corners.length]!
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cross === 0) continue
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  // A polygon with no area holds nothing.
  return sign !== 0
}
