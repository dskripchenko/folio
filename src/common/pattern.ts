/**
 * The pattern of a search, the same in the window and in the main process:
 * literal unless asked, case, a whole word by letters of any script.
 */

export interface FindOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export const MAX_MATCHES = 10_000

/** The pattern for a query; null for an empty query or an expression that does not compile. */
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
