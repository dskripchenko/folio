/**
 * Tags, as note-taking apps write them: `#word` and `#nested/tag` in a note's
 * text (a letter in them, at the start of a word — not `C#`, `#123`, a
 * heading or a link's `#anchor`), and the `tags:` of its front matter. The
 * tags of a root's notes, each with the notes that carry it.
 */
import { codeRanges } from './wikilinks'

const TAG = /(?<![^\s([{,;])#((?=[\p{L}\p{N}_/-]*[\p{L}_])[\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu

/** The front matter at a note's start: its text and how long it is; null when there is none. */
function frontMatter(text: string): { body: string; length: number } | null {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text)
  return m ? { body: m[1] ?? '', length: m[0].length } : null
}

/** The `tags:` (or `tag:`) of a front matter: a list in brackets, `- ` lines, or words with commas. */
function frontMatterTags(body: string): string[] {
  const out: string[] = []
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^tags?:\s*(.*)$/i.exec(lines[i] ?? '')
    if (!m) continue
    const value = (m[1] ?? '').trim()
    if (value.startsWith('[')) out.push(...value.replace(/^\[|\]$/g, '').split(','))
    else if (value !== '') out.push(...value.split(/[,\s]+/))
    else for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j] ?? ''); j++) out.push((lines[j] ?? '').replace(/^\s*-\s+/, ''))
  }
  return out.map((t) => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter((t) => t !== '')
}

/** A note's tags, each once, as written (the first spelling of each). */
export function tagsOf(text: string): string[] {
  const seen = new Map<string, string>()
  const add = (tag: string): void => {
    const name = tag.replace(/[/-]+$/, '')
    if (name !== '' && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  const front = frontMatter(text)
  if (front) frontMatterTags(front.body).forEach(add)
  const body = front ? ' '.repeat(front.length) + text.slice(front.length) : text
  // Code, link targets and internal links are not text: blanked out, the places kept.
  const taken = codeRanges(body)
  for (const m of body.matchAll(/\]\([^)\n]*\)|\[\[[^\]\n]*\]\]|<[a-z][^>\n]*>|https?:\/\/\S+/gi)) taken.push([m.index, m.index + m[0].length])
  for (const m of body.matchAll(TAG)) {
    if (!taken.some(([a, b]) => m.index >= a && m.index < b)) add(m[1]!)
  }
  return [...seen.values()]
}

/** Notes in the order of their names, then of their paths. */
function byName(a: string, b: string): number {
  const name = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)
  return name(a).localeCompare(name(b)) || a.localeCompare(b)
}

export interface TagEntry {
  tag: string
  /** The notes with the tag or one nested in it (`work` counts `work/urgent`'s). */
  notes: string[]
}

/** The tags of notes, sorted by name, their notes by name; a nested tag's notes count for its parents too. */
export function tagIndex(notes: { rel: string; text: string }[]): TagEntry[] {
  const byTag = new Map<string, { tag: string; notes: Set<string> }>()
  for (const n of notes) {
    for (const tag of tagsOf(n.text)) {
      const parts = tag.split('/')
      for (let k = 1; k <= parts.length; k++) {
        const name = parts.slice(0, k).join('/')
        const key = name.toLowerCase()
        if (!byTag.has(key)) byTag.set(key, { tag: name, notes: new Set() })
        byTag.get(key)!.notes.add(n.rel)
      }
    }
  }
  return [...byTag.values()]
    .map((e) => ({ tag: e.tag, notes: [...e.notes].sort(byName) }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}
