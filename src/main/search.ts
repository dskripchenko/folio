import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { matchesIn } from '../common/pattern'

/** A match in a file: its line (1-based) and a piece of that line around it. */
export interface Hit {
  line: number
  /** The line, or a window of a long one; the match is at [start, end) in it. */
  preview: string
  start: number
  end: number
}

export interface FileHits {
  root: string
  label: string | null
  path: string
  hits: Hit[]
  /** More matches in the file than listed. */
  more: boolean
}

export interface SearchFile {
  root: string
  label: string | null
  dir: string
  path: string
}

/** A file bigger than this is passed over (logs of hundreds of MB are searched in their view). */
export const MAX_FILE_BYTES = 8 * 1024 * 1024
/** Matches listed per file, and in all. */
export const PER_FILE = 200
export const TOTAL = 5_000
/** Files read at once. */
const READ_AHEAD = 32
/** A preview line longer than this is cut around the match. */
const PREVIEW = 220

/** Text, not binary: no NUL byte in its start. */
function isText(buf: Buffer): boolean {
  return !buf.subarray(0, 8000).includes(0)
}

async function read(file: string): Promise<string | null> {
  let handle
  try {
    handle = await open(file, 'r')
    const { size } = await handle.stat()
    if (size > MAX_FILE_BYTES) return null
    const buf = await handle.readFile()
    return isText(buf) ? buf.toString('utf8') : null
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

/** The matches in a text, with their lines. */
export function hitsIn(text: string, pattern: RegExp, limit = PER_FILE): { hits: Hit[]; more: boolean } {
  const found = matchesIn(text, pattern, limit + 1)
  const hits: Hit[] = []
  let line = 1
  let lineStart = 0
  let scanned = 0
  for (const [s, e] of found.slice(0, limit)) {
    for (let k = text.indexOf('\n', scanned); k >= 0 && k < s; k = text.indexOf('\n', k + 1)) {
      line++
      lineStart = k + 1
    }
    scanned = s
    let lineEnd = text.indexOf('\n', s)
    if (lineEnd < 0) lineEnd = text.length
    if (text[lineEnd - 1] === '\r') lineEnd--
    const end = Math.min(e, lineEnd)
    // A long line: a window around the match, marked as cut.
    let from = lineStart
    let to = lineEnd
    if (to - from > PREVIEW) {
      from = Math.max(lineStart, s - 60)
      to = Math.min(lineEnd, Math.max(end, from + PREVIEW))
    }
    const head = from > lineStart ? '…' : ''
    const preview = head + text.slice(from, to).replace(/\t/g, ' ') + (to < lineEnd ? '…' : '')
    hits.push({ line, preview, start: head.length + s - from, end: head.length + end - from })
  }
  return { hits, more: found.length > limit }
}

/**
 * Searches the files one after another, handing over what is found in
 * batches; stops when asked (a newer search) or at `TOTAL` matches.
 */
export async function searchFiles(
  files: SearchFile[],
  pattern: RegExp,
  onBatch: (batch: FileHits[]) => void,
  canceled: () => boolean,
): Promise<{ files: number; matches: number; truncated: boolean; canceled: boolean }> {
  let matches = 0
  let withHits = 0
  let batch: FileHits[] = []
  let last = Date.now()
  const flush = (): void => {
    if (batch.length > 0) onBatch(batch)
    batch = []
    last = Date.now()
  }
  // Read several at a time (the disk is the slow part), handed over in the files' order.
  for (let i = 0; i < files.length; i += READ_AHEAD) {
    if (canceled()) return { files: withHits, matches, truncated: false, canceled: true }
    const group = files.slice(i, i + READ_AHEAD)
    const texts = await Promise.all(group.map((f) => read(join(f.dir, ...f.path.split('/')))))
    for (let k = 0; k < group.length; k++) {
      const f = group[k]!
      const text = texts[k]
      if (text == null) continue
      pattern.lastIndex = 0
      if (!pattern.test(text)) continue
      const { hits, more } = hitsIn(text, pattern, Math.min(PER_FILE, TOTAL - matches))
      if (hits.length === 0) continue
      matches += hits.length
      withHits++
      batch.push({ root: f.root, label: f.label, path: f.path, hits, more })
      if (Date.now() - last > 60 || batch.length >= 25) flush()
      if (matches >= TOTAL) {
        flush()
        return { files: withHits, matches, truncated: true, canceled: false }
      }
    }
  }
  flush()
  return { files: withHits, matches, truncated: false, canceled: false }
}
