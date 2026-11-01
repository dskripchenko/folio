/**
 * Finding in the open document (Cmd+F): a bar over the page, every match
 * marked, the current one brought into view. Marks are CSS highlights over
 * ranges — the page's DOM is never changed, so an editor under them keeps
 * its caret and its undo. Three kinds of target:
 *
 * - the page as drawn (reading, the visual editor, a code view drawn whole):
 *   its visible text, block by block;
 * - a text field (the Markdown source, a file edited as text): its value,
 *   the current match framed over the field;
 * - a target of its own (a big file drawn a window at a time): the whole
 *   text, not only the lines in view.
 */

export interface FindOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** What a view searches itself with (a big code view). */
export interface FindTarget {
  /** Every match of the pattern; how many (at most `MAX_MATCHES`). */
  search(pattern: RegExp): number
  /** Mark the match the current one (-1: none) and, with `reveal`, bring it into view. */
  show(index: number, reveal?: boolean): void
  clear(): void
}

export const MAX_MATCHES = 10_000

/** The element a view hangs its own target on. */
export type WithFindTarget = HTMLElement & { folioFind?: FindTarget }

/** The pattern for a query: literal unless asked; a whole word by letters of any script. */
export function patternOf(query: string, o: FindOptions): RegExp | null {
  if (query === '') return null
  let source = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (o.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  try {
    return new RegExp(source, `gu${o.caseSensitive ? '' : 'i'}`)
  } catch {
    return null
  }
}

/** Matches in a text: [start, end) pairs, empty matches passed over. */
export function matchesIn(text: string, pattern: RegExp, limit = MAX_MATCHES): [number, number][] {
  const out: [number, number][] = []
  pattern.lastIndex = 0
  for (let m = pattern.exec(text); m && out.length < limit; m = pattern.exec(text)) {
    if (m[0] === '') {
      pattern.lastIndex = m.index + 1
      continue
    }
    out.push([m.index, m.index + m[0].length])
  }
  return out
}

const ALL = 'folio-find'
const CURRENT = 'folio-find-current'

/** Marks ranges as matches (and one as the current). */
export function mark(ranges: Range[], current: Range | null): void {
  const registry = CSS.highlights
  registry.set(ALL, new Highlight(...ranges))
  if (current) registry.set(CURRENT, new Highlight(current))
  else registry.delete(CURRENT)
}

export function unmark(): void {
  CSS.highlights.delete(ALL)
  CSS.highlights.delete(CURRENT)
}

// Text that ends where a block ends: a match does not run from one paragraph into the next.
const BLOCK = 'p, li, dt, dd, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, figcaption, summary, .code-line, div, section, article, header, footer, tr'

/** The page as drawn: its visible text nodes. */
export function domTarget(root: HTMLElement, skip: string): FindTarget {
  let ranges: Range[] = []
  return {
    search(pattern) {
      // The text of every visible text node, a separator where the block changes.
      const nodes: Text[] = []
      const starts: number[] = []
      let text = ''
      let block: Element | null = null
      const visible = new Map<Element, boolean>()
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const el = n.parentElement
          if (!el || n.nodeValue === '' || el.closest(`script, style, textarea, ${skip}`)) return NodeFilter.FILTER_REJECT
          let v = visible.get(el)
          if (v === undefined) visible.set(el, (v = el.checkVisibility({ visibilityProperty: true })))
          return v ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        },
      })
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const b = n.parentElement!.closest(BLOCK)
        if (b !== block) {
          text += '\u0000'
          block = b
        }
        nodes.push(n)
        starts.push(text.length)
        text += n.nodeValue
      }
      // Offsets in the joined text back to a node and an offset in it.
      const at = (offset: number, end: boolean): [Text, number] => {
        let lo = 0
        let hi = starts.length - 1
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if (starts[mid]! < offset || (!end && starts[mid] === offset)) lo = mid
          else hi = mid - 1
        }
        return [nodes[lo]!, offset - starts[lo]!]
      }
      ranges = matchesIn(text, pattern).map(([s, e]) => {
        const r = document.createRange()
        r.setStart(...at(s, false))
        r.setEnd(...at(e, true))
        return r
      })
      mark(ranges, null)
      return ranges.length
    },
    show(index, reveal = true) {
      const r = ranges[index]
      mark(ranges, r ?? null)
      if (!r || !reveal) return
      const box = r.getBoundingClientRect()
      const el = r.startContainer.parentElement!
      // Into view only when it is out of it: stepping through matches on one screen keeps the page still.
      if (box.top < 60 || box.bottom > innerHeight - 20) el.scrollIntoView({ block: 'center' })
      if (box.left < 0 || box.right > innerWidth) el.scrollIntoView({ block: 'nearest', inline: 'center' })
    },
    clear() {
      ranges = []
      unmark()
    },
  }
}

/** A text field: its value searched, the current match framed over the field. */
export function fieldTarget(area: HTMLTextAreaElement): FindTarget {
  let found: [number, number][] = []
  let current = -1
  const frames: HTMLElement[] = []
  const unframe = (): void => {
    for (const f of frames.splice(0)) f.remove()
  }
  // A copy of the field laid out the same way, to measure where text falls in it.
  const measure = (start: number, end: number): { rects: DOMRect[]; top: number } => {
    const style = getComputedStyle(area)
    const mirror = document.createElement('div')
    for (const p of ['font', 'letterSpacing', 'lineHeight', 'padding', 'border', 'boxSizing', 'tabSize', 'textIndent', 'wordSpacing'] as const) mirror.style[p] = style[p]
    const box = area.getBoundingClientRect()
    Object.assign(mirror.style, {
      position: 'fixed',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${area.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`,
      height: `${box.height}px`,
      overflow: 'hidden',
      whiteSpace: area.wrap === 'off' || style.whiteSpace === 'pre' ? 'pre' : 'pre-wrap',
      overflowWrap: 'break-word',
      visibility: 'hidden',
      pointerEvents: 'none',
    })
    const span = document.createElement('span')
    span.textContent = area.value.slice(start, end)
    mirror.append(area.value.slice(0, start), span, area.value.slice(end) || ' ')
    document.body.append(mirror)
    const top = span.offsetTop
    mirror.scrollTop = area.scrollTop
    mirror.scrollLeft = area.scrollLeft
    const rects = [...span.getClientRects()]
    mirror.remove()
    return { rects, top }
  }
  const frame = (): void => {
    unframe()
    const m = found[current]
    if (!m || !area.isConnected) return
    const clip = area.getBoundingClientRect()
    for (const r of measure(m[0], m[1]).rects) {
      if (r.bottom < clip.top || r.top > clip.bottom) continue
      const f = document.createElement('div')
      f.className = 'find-frame'
      Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
      document.body.append(f)
      frames.push(f)
    }
  }
  area.addEventListener('scroll', () => frames.length > 0 && frame())
  return {
    search(pattern) {
      found = matchesIn(area.value, pattern)
      current = -1
      unframe()
      return found.length
    },
    show(index, reveal = true) {
      current = index
      const m = found[index]
      if (!m) return unframe()
      if (reveal) {
        const { top } = measure(m[0], m[1])
        if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - 30) area.scrollTop = top - area.clientHeight / 2
        const box = area.getBoundingClientRect()
        if (box.bottom < 0 || box.top > innerHeight) area.scrollIntoView({ block: 'center' })
      }
      frame()
    },
    clear() {
      found = []
      current = -1
      unframe()
    },
  }
}

/** On Escape the field gets the current match selected, as editors do after a find. */
export function selectInField(area: HTMLTextAreaElement, pattern: RegExp | null, index: number): void {
  if (!pattern) return
  const m = matchesIn(area.value, pattern)[index]
  if (!m) return
  area.focus()
  area.setSelectionRange(m[0], m[1])
}
