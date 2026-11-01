/**
 * Fuzzy matching of a file's path: the query's characters in order, not
 * necessarily together (`rdr` finds `renderer.ts`). A match in the file's
 * name counts more than one in its folders, characters together more than
 * apart, and the start of a word (after `/`, `.`, `-`, `_`, a space or a
 * capital) most.
 */

export interface FuzzyMatch {
  score: number
  /** Positions of the matched characters in the path. */
  positions: number[]
}

const BOUNDARY = /[\\/._\- ]/

function matchFrom(query: string, text: string, lower: string, from: number): FuzzyMatch | null {
  const positions: number[] = []
  let score = 0
  let k = from
  for (const ch of query) {
    // The first place from here; a later one at a word's start is better.
    let at = lower.indexOf(ch, k)
    if (at < 0) return null
    const start = (i: number) => i === 0 || BOUNDARY.test(text[i - 1]!) || (text[i] !== lower[i] && text[i - 1] === lower[i - 1])
    if (!start(at) && positions[positions.length - 1] !== at - 1) {
      for (let j = at + 1; j < lower.length; j++) {
        if (lower[j] === ch && start(j)) {
          at = j
          break
        }
        if (BOUNDARY.test(text[j]!) && text[j] === '/') break
      }
    }
    score += 1
    if (positions.length > 0 && positions[positions.length - 1] === at - 1) score += 5
    if (start(at)) score += 8
    positions.push(at)
    k = at + 1
  }
  return { score, positions }
}

/** The match of the query in the path, or null; the higher the score, the better. */
export function fuzzyMatch(query: string, path: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (q === '') return { score: 0, positions: [] }
  const lower = path.toLowerCase()
  const nameStart = path.lastIndexOf('/') + 1
  // In the name alone first: that is what people type.
  const inName = matchFrom(q, path, lower, nameStart)
  const anywhere = inName ?? matchFrom(q, path, lower, 0)
  if (!anywhere) return null
  let score = anywhere.score * 10
  if (inName) {
    score += 50
    const name = lower.slice(nameStart)
    if (name.startsWith(q)) score += 60
    if (name === q || name.replace(/\.[^.]+$/, '') === q) score += 80
  }
  // Shorter paths first among equals.
  score -= path.length * 0.05
  return { score, positions: anywhere.positions }
}

/** The best `limit` items for the query, best first. */
export function rank<T>(query: string, items: readonly T[], pathOf: (item: T) => string, limit = 50): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch }[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, pathOf(item))
    if (match) out.push({ item, match })
  }
  return out.sort((a, b) => b.match.score - a.match.score).slice(0, limit)
}
