import { readdirSync, type Dirent } from 'node:fs'
import { formatByName } from './formats'
import { resolveInside } from './paths'

/** What folio does with a file: reads it, draws it (stage 5), or only lists it. */
export type Kind = 'markdown' | 'diagram' | 'other'

export interface Entry {
  name: string
  /** Path from the root, `/`-separated. */
  path: string
  type: 'dir' | 'file'
  kind?: Kind
}


/** Folders that are tooling, not documents: never listed. */
export const SKIP = new Set(['.git', 'node_modules', '.folio-data', 'folio-data', '.idea', '.vscode', '.DS_Store', 'Thumbs.db'])

/**
 * Markdown, a diagram (a drawn format, YAML — maybe an API — and JSON named
 * like an API description), or another file. `.txt` opens but is not listed.
 */
export function kindOf(name: string): Kind {
  const lower = name.toLowerCase()
  const format = formatByName(lower)
  if (format === 'markdown') return lower.endsWith('.txt') ? 'other' : 'markdown'
  if (format === 'text') return 'other'
  if (format === 'data' && lower.endsWith('.json')) return /openapi|swagger|asyncapi/.test(lower) ? 'diagram' : 'other'
  return 'diagram'
}

/**
 * One folder of a root: folders first, then files, each by name as people
 * sort (`2` before `10`); hidden files and tooling folders are left out, and
 * with `all` off only the files folio can open.
 */
export function listDir(root: string, rel: string, all = false): Entry[] | null {
  const dir = rel === '' ? resolveInside(root, '.') : resolveInside(root, rel)
  if (dir === null) return null
  let items: Dirent[]
  try {
    items = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const prefix = rel === '' ? '' : rel.replace(/\/+$/, '') + '/'
  const out: Entry[] = []
  for (const item of items) {
    if (item.name.startsWith('.') || SKIP.has(item.name)) continue
    if (item.isDirectory()) {
      out.push({ name: item.name, path: prefix + item.name, type: 'dir' })
    } else if (item.isFile()) {
      const kind = kindOf(item.name)
      if (all || kind !== 'other') out.push({ name: item.name, path: prefix + item.name, type: 'file', kind })
    }
  }
  return out.sort((a, b) => (a.type === b.type ? collator.compare(a.name, b.name) : a.type === 'dir' ? -1 : 1))
}
