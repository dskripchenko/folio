import { diffArrays } from '../../common/diff'
import { splitLines, type Hunk } from '../../common/hunks'

/**
 * A file's changes as rows to draw (ADR-006, R2): the changed lines with a
 * little context, the unchanged stretches between folded into gaps, the
 * words that changed within a changed line marked.
 */

/** A line of either side: its number there (0-based), its text without the line end. */
export interface Row {
  kind: 'same' | 'del' | 'add'
  /** Line numbers (0-based) in the text before and after; null where the line is not on that side. */
  a: number | null
  b: number | null
  /** The run of changes it belongs to (changed lines only). */
  hunk?: number
  /** Changed words: [start, end) in the line's text. */
  words?: [number, number][]
}

export type Block =
  | { kind: 'hunk'; index: number; hunk: Hunk }
  | { kind: 'rows'; rows: Row[] }
  /** Unchanged lines folded: rows [from, to) of the whole alignment. */
  | { kind: 'gap'; from: number; to: number }

export interface FileDiff {
  before: string[]
  after: string[]
  /** Every line of both, aligned. */
  rows: Row[]
  hunks: Hunk[]
}

const strip = (line: string) => line.replace(/\r?\n$/, '')

export function fileDiff(before: string | null, after: string | null): FileDiff {
  const a = splitLines(before ?? '')
  const b = splitLines(after ?? '')
  const rows: Row[] = []
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let open: Hunk | null = null
  for (const kind of diffArrays(a, b)) {
    if (kind === 'same') {
      open = null
      rows.push({ kind, a: i++, b: j++ })
      continue
    }
    if (!open) {
      open = { a: i, aEnd: i, b: j, bEnd: j }
      hunks.push(open)
    }
    if (kind === 'del') {
      rows.push({ kind, a: i++, b: null, hunk: hunks.length - 1 })
      open.aEnd = i
    } else {
      rows.push({ kind, a: null, b: j++, hunk: hunks.length - 1 })
      open.bEnd = j
    }
  }
  const diff = { before: a.map(strip), after: b.map(strip), rows, hunks }
  markWords(diff)
  return diff
}

/**
 * The rows shown: each run with `context` lines around it; the rest folded
 * into gaps, but for those opened (by the row index they start at).
 */
export function blocksOf(diff: FileDiff, context = 3, opened: ReadonlySet<number> = new Set(), keep: ReadonlySet<number> = new Set()): Block[] {
  const n = diff.rows.length
  const shown = new Uint8Array(n)
  diff.rows.forEach((r, k) => {
    // A changed row with its context; a row kept (a comment on it) with a line either side.
    const reach = r.kind !== 'same' ? context : keep.has(k) ? 1 : -1
    for (let x = Math.max(0, k - reach); x <= Math.min(n - 1, k + reach); x++) shown[x] = 1
  })
  // Gaps opened by a click; a gap of a line or two is not worth folding.
  const gaps: [number, number][] = []
  for (let k = 0; k < n; ) {
    if (shown[k]) {
      k++
      continue
    }
    let end = k
    while (end < n && !shown[end]) end++
    if (opened.has(k) || end - k <= 2) shown.fill(1, k, end)
    else gaps.push([k, end])
    k = end
  }
  const blocks: Block[] = []
  let rows: Row[] = []
  const flush = () => {
    if (rows.length) blocks.push({ kind: 'rows', rows })
    rows = []
  }
  let gap = 0
  let lastHunk = -1
  for (let k = 0; k < n; k++) {
    if (!shown[k]) {
      const [from, to] = gaps[gap++]!
      flush()
      blocks.push({ kind: 'gap', from, to })
      k = to - 1
      continue
    }
    const r = diff.rows[k]!
    if (r.hunk !== undefined && r.hunk !== lastHunk) {
      lastHunk = r.hunk
      const head: Block = { kind: 'hunk', index: r.hunk, hunk: diff.hunks[r.hunk]! }
      // The first run of a stretch: its head above the context before it; a later one, where it starts.
      if (rows.some((x) => x.kind !== 'same')) {
        flush()
        blocks.push(head)
      } else blocks.push(head)
    }
    rows.push(r)
  }
  flush()
  return blocks
}

/** Words, spaces and single signs: the units a changed line is compared in. */
function tokens(line: string): string[] {
  return line.match(/\w+|\s+|[^\w\s]/gu) ?? []
}

/**
 * Within each run, a removed line and the added line at the same place,
 * when they are alike: the words that differ marked in both.
 */
function markWords(diff: FileDiff): void {
  const byHunk = new Map<number, { del: Row[]; add: Row[] }>()
  for (const r of diff.rows) {
    if (r.hunk === undefined) continue
    const g = byHunk.get(r.hunk) ?? { del: [], add: [] }
    if (r.kind === 'del') g.del.push(r)
    else g.add.push(r)
    byHunk.set(r.hunk, g)
  }
  for (const { del, add } of byHunk.values()) {
    for (let k = 0; k < Math.min(del.length, add.length); k++) {
      const x = diff.before[del[k]!.a!]!
      const y = diff.after[add[k]!.b!]!
      if (x.length + y.length > 4000) continue
      const tx = tokens(x)
      const ty = tokens(y)
      const ops = diffArrays(tx, ty)
      let same = 0
      for (const op of ops) if (op === 'same') same++
      // Too little in common: two different lines, not one edited.
      if (same * 2 < Math.max(tx.length, ty.length)) continue
      const wx: [number, number][] = []
      const wy: [number, number][] = []
      let px = 0
      let py = 0
      let ix = 0
      let iy = 0
      for (const op of ops) {
        if (op === 'same') {
          px += tx[ix++]!.length
          py += ty[iy++]!.length
        } else if (op === 'del') {
          const len = tx[ix++]!.length
          push(wx, px, px + len)
          px += len
        } else {
          const len = ty[iy++]!.length
          push(wy, py, py + len)
          py += len
        }
      }
      if (wx.length) del[k]!.words = wx
      if (wy.length) add[k]!.words = wy
    }
  }
}

/** A range added, joined to the one before when they touch. */
function push(list: [number, number][], from: number, to: number): void {
  const last = list[list.length - 1]
  if (last && last[1] === from) last[1] = to
  else list.push([from, to])
}

/**
 * Highlighted HTML of a line with ranges of its text wrapped in
 * `<span class="cls">` — closed and opened again around the highlighter's
 * own tags, so the markup stays whole. An entity counts as one character.
 */
export function markRanges(html: string, ranges: readonly [number, number][], cls: string): string {
  if (!ranges.length) return html
  const open = `<span class="${cls}">`
  let out = ''
  let pos = 0
  let r = 0
  let inside = false
  for (let k = 0; k < html.length; ) {
    if (html[k] === '<') {
      const end = html.indexOf('>', k)
      const tag = html.slice(k, end + 1)
      out += inside ? `</span>${tag}${open}` : tag
      k = end + 1
      continue
    }
    while (r < ranges.length && pos >= ranges[r]![1]) r++
    const want = r < ranges.length && pos >= ranges[r]![0] && pos < ranges[r]![1]
    if (want && !inside) out += open
    else if (!want && inside) out += '</span>'
    inside = want
    let len = 1
    if (html[k] === '&') {
      const semi = html.indexOf(';', k)
      if (semi > k && semi - k < 10) len = semi - k + 1
    }
    out += html.slice(k, k + len)
    k += len
    pos++
  }
  if (inside) out += '</span>'
  // An empty span around tags only: harmless, but not kept.
  return out.split(`${open}</span>`).join('')
}
