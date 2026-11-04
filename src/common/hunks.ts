import { diffArrays } from './diff'

/**
 * A file's changes as runs of lines (hunks), and the review's actions on one
 * run done on texts (ADR-006, R1): staged, taken out of the index, thrown
 * away. Lines keep their own ends (`\n`, `\r\n`, none on the last), so a
 * text put back together is the same bytes.
 */

/** The lines of a text, each with its line end. */
export function splitLines(text: string): string[] {
  return text === '' ? [] : (text.match(/[^\n]*\n|[^\n]+$/g) ?? [])
}

/** A run of changed lines: `before[a, aEnd)` became `after[b, bEnd)` (an empty range: nothing there). */
export interface Hunk {
  a: number
  aEnd: number
  b: number
  bEnd: number
}

export function hunksOf(before: readonly string[], after: readonly string[]): Hunk[] {
  const out: Hunk[] = []
  let i = 0
  let j = 0
  let open: Hunk | null = null
  for (const kind of diffArrays(before, after)) {
    if (kind === 'same') {
      if (open) out.push(open)
      open = null
      i++
      j++
      continue
    }
    open ??= { a: i, aEnd: i, b: j, bEnd: j }
    if (kind === 'del') open.aEnd = ++i
    else open.bEnd = ++j
  }
  if (open) out.push(open)
  return out
}

/** Whether two line ranges meet (an empty one counts as the line it stands before). */
function meets(x: number, xEnd: number, y: number, yEnd: number): boolean {
  return x < Math.max(yEnd, y + 1) && y < Math.max(xEnd, x + 1)
}

/** `lines` with each hunk's `from` range in it replaced by the `to` range of `source` (hunks in order). */
function replaced(lines: readonly string[], source: readonly string[], runs: { from: [number, number]; to: [number, number] }[]): string {
  const out = [...lines]
  for (const r of [...runs].sort((p, q) => q.from[0] - p.from[0])) out.splice(r.from[0], r.from[1] - r.from[0], ...source.slice(r.to[0], r.to[1]))
  return out.join('')
}

/**
 * The index with one change of the working file staged: `hunk` is a run of
 * HEAD → working file; the index takes the working file's lines where they
 * differ from it within the run's lines.
 */
export function stageHunk(index: string, working: string, hunk: Hunk): string {
  const i = splitLines(index)
  const w = splitLines(working)
  const runs = hunksOf(i, w).filter((h) => meets(h.b, h.bEnd, hunk.b, hunk.bEnd))
  return replaced(i, w, runs.map((h) => ({ from: [h.a, h.aEnd], to: [h.b, h.bEnd] })))
}

/** The index with one run of HEAD → working file taken out: back to HEAD within the run's HEAD lines. */
export function unstageHunk(head: string, index: string, hunk: Hunk): string {
  const h = splitLines(head)
  const i = splitLines(index)
  const runs = hunksOf(h, i).filter((x) => meets(x.a, x.aEnd, hunk.a, hunk.aEnd))
  return replaced(i, h, runs.map((x) => ({ from: [x.b, x.bEnd], to: [x.a, x.aEnd] })))
}

/** The working file with one run thrown away: its lines as in `before`. */
export function discardHunk(before: string, working: string, hunk: Hunk): string {
  const b = splitLines(before)
  const w = splitLines(working)
  return replaced(w, b, [{ from: [hunk.b, hunk.bEnd], to: [hunk.a, hunk.aEnd] }])
}

export type HunkState = 'staged' | 'unstaged' | 'partly'

/** Where a run of HEAD → working file stands: all in the index, none of it, or some. */
export function hunkState(head: string, index: string, working: string, hunk: Hunk): HunkState {
  const toWork = hunksOf(splitLines(index), splitLines(working)).some((h) => meets(h.b, h.bEnd, hunk.b, hunk.bEnd))
  const fromHead = hunksOf(splitLines(head), splitLines(index)).some((h) => meets(h.a, h.aEnd, hunk.a, hunk.aEnd))
  return !toWork ? 'staged' : !fromHead ? 'unstaged' : 'partly'
}

/** The same run in another pair of texts: by its place and its lines, or null when the texts changed there. */
export function findHunk(before: string, after: string, hunk: Hunk & { lines?: { before: string[]; after: string[] } }): Hunk | null {
  const bl = splitLines(before)
  const al = splitLines(after)
  const found = hunksOf(bl, al).find((h) => h.a === hunk.a && h.aEnd === hunk.aEnd && h.b === hunk.b && h.bEnd === hunk.bEnd)
  if (!found) return null
  if (hunk.lines && (bl.slice(found.a, found.aEnd).join('') !== hunk.lines.before.join('') || al.slice(found.b, found.bEnd).join('') !== hunk.lines.after.join(''))) return null
  return found
}
