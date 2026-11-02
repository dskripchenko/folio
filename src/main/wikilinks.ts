/**
 * Links between notes, as in a notes app: `[[Name]]`, `[[Name#Heading|text]]`
 * and `![[picture.png]]` name a file of the same root by its name, wherever
 * it lies — the note's own folder first, then the shortest path. A file
 * renamed or moved: the links to it, and the moved note's own relative links,
 * are written anew in the root's notes.
 */
import { readdir } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import { NOT_INDEXED } from './fileIndex'
import { SKIP } from './tree'

/** How many files of a root links are resolved against at most. */
export const MAX_LINKED = 50_000

const MD = /\.(md|markdown)$/i

/** A link's target split: the name, and the heading (`#Heading`, `#^block`) after it. */
export function wikiTarget(raw: string): { name: string; heading: string | null } {
  const i = raw.indexOf('#')
  if (i < 0) return { name: raw.trim(), heading: null }
  return { name: raw.slice(0, i).trim(), heading: raw.slice(i + 1).trim() || null }
}

/** A path's name for a link: a note without its extension, any other file with it. */
function nameOf(rel: string): string {
  return rel.replace(MD, '')
}

function matches(rel: string, name: string): boolean {
  const target = name.toLowerCase().replace(/^\/+/, '')
  const path = rel.toLowerCase()
  const bare = nameOf(path)
  for (const candidate of MD.test(path) ? [bare, path] : [path]) {
    if (candidate === target || candidate.endsWith('/' + target)) return true
  }
  return false
}

/**
 * The file a link names, seen from a note (`fromRel`, both paths from the
 * root, `/`-separated): the same folder first, then the shortest path.
 */
export function resolveWiki(name: string, fromRel: string, files: string[]): string | null {
  if (name === '') return fromRel
  const found = files.filter((f) => matches(f, name))
  if (found.length === 0) return null
  const dir = posix.dirname(fromRel)
  const here = found.find((f) => posix.dirname(f) === dir)
  if (here) return here
  return found.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b))[0]!
}

/** How a link names a file: its name alone when no other file has it, its path otherwise. */
export function linkName(rel: string, files: string[]): string {
  const base = posix.basename(nameOf(rel))
  const same = files.filter((f) => matches(f, base))
  return same.length <= 1 ? base : nameOf(rel)
}

/** The parts of a note that are code: links there are text, not links. */
export function codeRanges(text: string): [number, number][] {
  const out: [number, number][] = []
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm
  for (const m of text.matchAll(fence)) out.push([m.index, m.index + m[0].length])
  const inline = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g
  for (const m of text.matchAll(inline)) {
    if (!out.some(([a, b]) => m.index >= a && m.index < b)) out.push([m.index, m.index + m[0].length])
  }
  return out
}

/** Every `[[link]]` outside code: where it is and what it names. */
export function wikiLinksIn(text: string): { index: number; length: number; embed: boolean; target: string; alias: string | null }[] {
  const code = codeRanges(text)
  const out = []
  for (const m of text.matchAll(/(!?)\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g)) {
    if (code.some(([a, b]) => m.index >= a && m.index < b)) continue
    out.push({ index: m.index, length: m[0].length, embed: m[1] === '!', target: m[2]!, alias: m[3] ?? null })
  }
  return out
}

/** A relative link's target — not the web, not an anchor, not from the root. */
function relativeTarget(href: string): boolean {
  return href !== '' && !href.startsWith('#') && !href.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(href)
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * A note's text with its links written for a move: `[[links]]` to a moved
 * file get its new name; relative Markdown links (`[t](x.md)`, `![](p.png)`,
 * `[id]: x.md`) to a moved file — or from the moved note itself — get the new
 * relative path. `moved` maps a path before the move to the one after, or
 * gives null for a file that stayed; `before`/`after` are the root's files.
 */
export function rewriteLinks(
  text: string,
  relBefore: string,
  relAfter: string,
  moved: (rel: string) => string | null,
  before: string[],
  after: string[],
): string {
  const code = codeRanges(text)
  const inCode = (i: number): boolean => code.some(([a, b]) => i >= a && i < b)
  const edits: { index: number; length: number; text: string }[] = []

  for (const link of wikiLinksIn(text)) {
    const { name, heading } = wikiTarget(link.target)
    if (name === '') continue
    const target = resolveWiki(name, relBefore, before)
    const to = target === null ? null : moved(target)
    if (to === null) continue
    // A path written in the link stays a path; a bare name stays the shortest name that is still unique.
    let written = name.includes('/') ? nameOf(to) : linkName(to, after)
    // `[[Note.md]]` keeps its extension.
    if (MD.test(name) && MD.test(to)) written += to.slice(to.search(MD))
    const label = (heading ? `${written}#${heading}` : written) + (link.alias !== null ? `|${link.alias}` : '')
    edits.push({ index: link.index, length: link.length, text: `${link.embed ? '!' : ''}[[${label}]]` })
  }

  const fromDir = posix.dirname(relBefore)
  const toDir = posix.dirname(relAfter)
  const relink = (href: string): string | null => {
    const angled = href.startsWith('<') && href.endsWith('>')
    const raw = angled ? href.slice(1, -1) : href
    if (!relativeTarget(raw)) return null
    const cut = raw.search(/[?#]/)
    const path = cut < 0 ? raw : raw.slice(0, cut)
    const rest = cut < 0 ? '' : raw.slice(cut)
    if (path === '') return null
    const target = posix.normalize(posix.join(fromDir, decode(path)))
    if (target.startsWith('../')) return null
    const to = moved(target) ?? target
    if (to === target && fromDir === toDir) return null
    let next = posix.relative(toDir, to) || posix.basename(to)
    if (path.startsWith('./') && !next.startsWith('../')) next = './' + next
    if (angled) return `<${next}${rest}>`
    // Written as it was: encoded when the link was, spaces made safe either way.
    const encoded = /%[0-9a-f]{2}/i.test(path) ? next.split('/').map(encodeURIComponent).join('/') : next.replace(/ /g, '%20')
    return encoded + rest
  }
  const inline = /(!?\[(?:[^\]\n]|\][^(\n])*\]\()(<[^>\n]+>|[^)\s]+)/g
  for (const m of text.matchAll(inline)) {
    if (inCode(m.index)) continue
    const next = relink(m[2]!)
    if (next !== null) edits.push({ index: m.index + m[1]!.length, length: m[2]!.length, text: next })
  }
  const definition = /^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|\S+)/gm
  for (const m of text.matchAll(definition)) {
    if (inCode(m.index)) continue
    const next = relink(m[2]!)
    if (next !== null) edits.push({ index: m.index + m[1]!.length, length: m[2]!.length, text: next })
  }

  if (edits.length === 0) return text
  edits.sort((a, b) => b.index - a.index)
  let out = text
  for (const e of edits) out = out.slice(0, e.index) + e.text + out.slice(e.index + e.length)
  return out
}

/** Every file of a root, `/`-separated from it: what links are resolved against. */
export async function filesOf(dir: string): Promise<string[]> {
  const out: string[] = []
  const queue = [dir]
  while (queue.length > 0 && out.length < MAX_LINKED) {
    const current = queue.shift()!
    let items
    try {
      items = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const item of items) {
      if (item.name.startsWith('.') || SKIP.has(item.name)) continue
      const full = join(current, item.name)
      if (item.isDirectory()) {
        if (!NOT_INDEXED.has(item.name)) queue.push(full)
      } else if (item.isFile()) out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  return out
}

/** A path's new place for a move of `from` to `to` (a file, or a folder and all in it), or null. */
export function mover(from: string, to: string): (rel: string) => string | null {
  return (rel) => (rel === from ? to : rel.startsWith(from + '/') ? to + rel.slice(from.length) : null)
}

export function isNote(rel: string): boolean {
  return MD.test(rel)
}

/** A place in a note: its line (from 1), the line as shown, the match within it and in the whole text. */
export interface LinkPlace {
  line: number
  preview: string
  start: number
  end: number
  /** In the whole text. */
  index: number
  length: number
  /** What a reader sees of it in the drawn note, and which of its kind it is there (for finding it). */
  display: string
  nth: number
}

/** A note's link: where, to what (a path from the root, or null when it reaches no file). */
export interface NoteLink extends LinkPlace {
  target: string | null
  raw: string
  /** `[[…]]`, not a Markdown link. */
  wiki: boolean
}

const PREVIEW = 160

function placeOf(text: string, index: number, length: number, display: string): LinkPlace {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  const lineEnd = text.indexOf('\n', index)
  const whole = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd)
  let start = index - lineStart
  let preview = whole
  // A long line: the part around the match, so it is seen.
  if (whole.length > PREVIEW) {
    const from = Math.max(0, start - 40)
    preview = (from > 0 ? '…' : '') + whole.slice(from, from + PREVIEW) + (from + PREVIEW < whole.length ? '…' : '')
    start = start - from + (from > 0 ? 1 : 0)
  }
  const lead = preview.length - preview.trimStart().length
  preview = preview.trim()
  start -= lead
  const line = text.slice(0, index).split('\n').length
  const before = text.slice(0, index).toLowerCase()
  let nth = 0
  for (let i = before.indexOf(display.toLowerCase()); i >= 0 && display !== ''; i = before.indexOf(display.toLowerCase(), i + 1)) nth++
  return { line, preview, start: Math.max(0, start), end: Math.min(preview.length, start + length), index, length, display, nth }
}

/** Every link of a note, `[[…]]` and relative Markdown links, with what it reaches. */
export function linksOf(text: string, rel: string, files: string[]): NoteLink[] {
  const out: NoteLink[] = []
  for (const link of wikiLinksIn(text)) {
    const { name, heading } = wikiTarget(link.target)
    const display = link.alias ?? (heading ? `${name} › ${heading}` : name)
    const target = name === '' ? rel : resolveWiki(name, rel, files)
    out.push({ ...placeOf(text, link.index, link.length, link.embed ? '' : display), target, raw: link.target, wiki: true })
  }
  const code = codeRanges(text)
  const dir = posix.dirname(rel)
  const known = new Set(files)
  for (const m of text.matchAll(/(!?)\[((?:[^\]\n]|\][^(\n])*)\]\((<[^>\n]+>|[^)\s]+)[^)\n]*\)/g)) {
    if (code.some(([a, b]) => m.index >= a && m.index < b)) continue
    const href = m[3]!.replace(/^<|>$/g, '')
    if (!relativeTarget(href)) continue
    const path = decode(href.split(/[?#]/)[0] ?? '')
    if (path === '') continue
    const resolved = posix.normalize(posix.join(dir, path))
    const target = known.has(resolved) ? resolved : known.has(resolved + '.md') ? resolved + '.md' : null
    out.push({ ...placeOf(text, m.index, m[0].length, m[1] ? '' : m[2]!), target, raw: href, wiki: false })
  }
  return out.sort((a, b) => a.index - b.index)
}

/** The notes that link to a note, each with its links' places. */
export function backlinksOf(noteRel: string, notes: { rel: string; text: string }[], files: string[]): { rel: string; places: LinkPlace[] }[] {
  const out = []
  for (const n of notes) {
    if (n.rel === noteRel) continue
    const places = linksOf(n.text, n.rel, files).filter((l) => l.target === noteRel)
    if (places.length > 0) out.push({ rel: n.rel, places })
  }
  return byName(out)
}

/** Notes in the order of their names, then of their paths. */
function byName<T extends { rel: string }>(list: T[]): T[] {
  return list.sort((a, b) => posix.basename(a.rel).localeCompare(posix.basename(b.rel)) || a.rel.localeCompare(b.rel))
}

/**
 * The notes that name a note without linking to it: its name as a whole word,
 * outside links and code — candidates for a link.
 */
export function mentionsOf(noteRel: string, notes: { rel: string; text: string }[], limit = 200): { rel: string; places: LinkPlace[] }[] {
  const name = posix.basename(nameOf(noteRel))
  if (name.length < 3) return []
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
  const out = []
  let total = 0
  for (const n of notes) {
    if (n.rel === noteRel || total >= limit) continue
    // Links and code are not mentions.
    const taken = codeRanges(n.text)
    for (const m of n.text.matchAll(/!?\[\[[^\]\n]*\]\]|!?\[(?:[^\]\n]|\][^(\n])*\]\([^)\n]*\)|<https?:[^>\n]*>|https?:\/\/\S+/g)) taken.push([m.index, m.index + m[0].length])
    const places = []
    for (const m of n.text.matchAll(pattern)) {
      if (taken.some(([a, b]) => m.index >= a && m.index < b)) continue
      places.push(placeOf(n.text, m.index, m[0].length, m[0]))
      if (++total >= limit) break
    }
    if (places.length > 0) out.push({ rel: n.rel, places })
  }
  return byName(out)
}

/** A mention made a link: `[[Name]]`, or `[[Name|as written]]` when written otherwise. Null when the text has moved on. */
export function linkMention(text: string, index: number, length: number, link: string): string | null {
  const written = text.slice(index, index + length)
  if (written.toLowerCase() !== posix.basename(link).toLowerCase() && written.toLowerCase() !== link.toLowerCase()) return null
  const label = written === posix.basename(link) || written === link ? `[[${link}]]` : `[[${link}|${written}]]`
  return text.slice(0, index) + label + text.slice(index + length)
}
