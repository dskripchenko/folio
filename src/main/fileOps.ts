import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, sep } from 'node:path'

/**
 * Files and folders made, renamed, moved and copied from the tree. Names are
 * checked (no separators, nothing that exists already); paths are the main
 * process's to resolve, inside folders folio knows. Deleting goes to the
 * system's trash and is the caller's (Electron's `shell.trashItem`).
 */
export class FileOpError extends Error {}

// Separators, Windows' reserved signs, and control characters.
const BAD = /[\\/:*?"<>|]/
const control = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 32)

/** A name as given, or the reason it cannot be one. */
export function checkName(name: string): string {
  const n = name.trim()
  if (n === '' || n === '.' || n === '..') throw new FileOpError('empty')
  if (BAD.test(n) || control(n)) throw new FileOpError('characters')
  if (n.length > 200) throw new FileOpError('long')
  return n
}

/** A new note (Markdown unless the name says otherwise) or a folder in a folder; its path. */
export function create(dir: string, name: string, kind: 'note' | 'folder'): string {
  let n = checkName(name)
  if (kind === 'note' && extname(n) === '') n += '.md'
  const target = join(dir, n)
  if (existsSync(target)) throw new FileOpError('exists')
  if (kind === 'folder') mkdirSync(target)
  else writeFileSync(target, extname(n) === '.md' ? `# ${n.replace(/\.md$/, '')}\n\n` : '', { flag: 'wx' })
  return target
}

/** Renamed in its folder; a note keeps its extension when the new name has none. */
export function rename(path: string, name: string): string {
  let n = checkName(name)
  if (statSync(path).isFile() && extname(n) === '' && extname(path) !== '') n += extname(path)
  const target = join(dirname(path), n)
  if (target === path) return path
  // A change of letter case only (macOS, Windows): the same file to the file system.
  if (existsSync(target) && target.toLowerCase() !== path.toLowerCase()) throw new FileOpError('exists')
  renameSync(path, target)
  return target
}

/** Moved into a folder (not into itself or below it); its new path. */
export function move(path: string, dir: string): string {
  const target = join(dir, basename(path))
  if (target === path) return path
  const rel = relative(path, dir)
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel))) throw new FileOpError('inside')
  if (existsSync(target)) throw new FileOpError('exists')
  try {
    renameSync(path, target)
  } catch (e) {
    // Another disk: copied there, then the original removed.
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    cpSync(path, target, { recursive: true, errorOnExist: true })
    rmSync(path, { recursive: true, force: true })
  }
  return target
}

/** A copy beside it: `name copy.md`, `name copy 2.md`. */
export function duplicate(path: string): string {
  const ext = statSync(path).isFile() ? extname(path) : ''
  const stem = basename(path, ext)
  for (let i = 1; i < 1000; i++) {
    const target = join(dirname(path), `${stem} copy${i > 1 ? ` ${i}` : ''}${ext}`)
    if (existsSync(target)) continue
    cpSync(path, target, { recursive: true, errorOnExist: true })
    return target
  }
  throw new FileOpError('exists')
}

/** The folder pictures pasted into a note go to, beside it. */
export const ATTACHMENTS = 'attachments'

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
}

/**
 * A picture pasted or dropped into a note, saved in `attachments/` beside it:
 * by its own name, or `Pasted image <time>` for a nameless screenshot; a name
 * taken gets ` 1`, ` 2`… Its path from the note's folder, `/`-separated.
 */
export function saveAttachment(note: string, name: string, type: string, bytes: Uint8Array, now = new Date()): string {
  const ext = IMAGE_EXT[type]
  if (!ext) throw new FileOpError('type')
  const dir = join(dirname(note), ATTACHMENTS)
  mkdirSync(dir, { recursive: true })
  let base = [...name.replace(/\.[^.]*$/, '')].filter((c) => !BAD.test(c) && !control(c)).join('').trim()
  if (/^(image|blob|untitled)?$/i.test(base)) {
    const pad = (n: number): string => String(n).padStart(2, '0')
    base = `Pasted image ${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  }
  base = base.slice(0, 150)
  const own = extname(name).toLowerCase()
  const suffix = own && Object.values(IMAGE_EXT).includes(own === '.jpeg' ? '.jpg' : own) ? own : ext
  for (let i = 0; ; i++) {
    const file = `${base}${i === 0 ? '' : ` ${i}`}${suffix}`
    try {
      writeFileSync(join(dir, file), bytes, { flag: 'wx' })
      return `${ATTACHMENTS}/${file}`
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
}
