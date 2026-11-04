import type { ReviewComment } from '../../common/review'
import type { FileDiff, Row } from './rows'

/**
 * Comments on lines (ADR-006, R5): found again where the lines they were made
 * on are now; put together as one text for the agent.
 */

/**
 * The line a comment is on now (0-based on its side), or -1 when its lines are
 * gone: where the excerpt reads the same, the nearest to where it was made.
 */
export function anchorOf(c: Pick<ReviewComment, 'line' | 'excerpt'>, lines: readonly string[]): number {
  const last = c.excerpt[c.excerpt.length - 1]
  if (last === undefined) return -1
  let best = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== last) continue
    let ok = true
    for (let k = 1; k < c.excerpt.length && ok; k++) {
      const want = c.excerpt[c.excerpt.length - 1 - k]
      if (i - k >= 0 && lines[i - k] !== want) ok = false
    }
    if (ok && (best < 0 || Math.abs(i - (c.line - 1)) < Math.abs(best - (c.line - 1)))) best = i
  }
  return best
}

/** The excerpt a comment keeps: the line and up to two before it on its side. */
export function excerptOf(lines: readonly string[], index: number): string[] {
  return lines.slice(Math.max(0, index - 2), index + 1)
}

/** The rows around one, as the review shows them (`-`, `+`, ` ` first), for the agent to see what is meant. */
export function contextOf(diff: FileDiff, rowIndex: number, around = 3): string[] {
  const rows = diff.rows.slice(Math.max(0, rowIndex - around), rowIndex + around + 1)
  return rows.map((r: Row) => (r.kind === 'del' ? `-${diff.before[r.a!]}` : r.kind === 'add' ? `+${diff.after[r.b!]}` : ` ${diff.after[r.b!] ?? diff.before[r.a!]}`))
}

export { compose } from '../../common/review'
