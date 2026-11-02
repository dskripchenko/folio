/**
 * A search query's filters, read the same in the window and in the main
 * process: `tag:`, `path:` and `file:` choose the files, the rest is the text
 * to find in them.
 */

/** A query's filters — `tag:`, `path:`, `file:` (a value in quotes may have spaces) — and the text left to find. */
export interface SearchQuery {
  text: string
  tags: string[]
  paths: string[]
  files: string[]
}

export function parseQuery(query: string): SearchQuery {
  const out: SearchQuery = { text: '', tags: [], paths: [], files: [] }
  const rest = query.replace(/(?:^|\s)(tag|path|file):(?:"([^"]*)"|(\S+))/gi, (_m, key: string, quoted?: string, bare?: string) => {
    const value = (quoted ?? bare ?? '').trim()
    if (value !== '') {
      const k = key.toLowerCase()
      if (k === 'tag') out.tags.push(value.replace(/^#/, '').toLowerCase())
      else if (k === 'path') out.paths.push(value.toLowerCase())
      else out.files.push(value.toLowerCase())
    }
    return ' '
  })
  out.text = rest.trim()
  return out
}

/** Whether a file's path (from its root) passes a query's `path:` and `file:` filters. */
export function pathPasses(query: SearchQuery, rel: string): boolean {
  const path = rel.toLowerCase()
  const name = path.slice(path.lastIndexOf('/') + 1)
  return query.paths.every((p) => path.includes(p)) && query.files.every((f) => name.includes(f))
}

/** Whether a note's tags pass a query's `tag:` filters (`work` takes `work/urgent` too). */
export function tagsPass(query: SearchQuery, tags: string[]): boolean {
  const own = tags.map((t) => t.toLowerCase())
  return query.tags.every((want) => own.some((t) => t === want || t.startsWith(want + '/')))
}
