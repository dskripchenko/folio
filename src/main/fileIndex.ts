import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { kindOf, type Kind } from './tree'
import type { Visibility } from './visibility'

/** A file folio opens, in a root: for going to a file by its name. */
export interface IndexedFile {
  root: string
  /** Path from the root, `/`-separated. */
  path: string
  kind: Kind
}

export { NOT_INDEXED } from './visibility'

/** How many files a root lists at most: a home folder added as a project is not walked whole. */
export const MAX_FILES = 50_000

/**
 * The files of every root, walked once and kept until the disk says
 * otherwise: a file added, removed or renamed under a root (not one only
 * saved) makes it walked again the next time it is asked for.
 */
export class FileIndex {
  private readonly cache = new Map<string, { dir: string; files: IndexedFile[]; known: Set<string> }>()
  private readonly walking = new Map<string, Promise<IndexedFile[]>>()

  async files(root: string, dir: string, visibility: Visibility): Promise<IndexedFile[]> {
    const hit = this.cache.get(root)
    if (hit && hit.dir === dir) return hit.files
    let pending = this.walking.get(root)
    if (!pending) {
      pending = walk(root, dir, visibility).finally(() => this.walking.delete(root))
      this.walking.set(root, pending)
    }
    const files = await pending
    this.cache.set(root, { dir, files, known: new Set(files.map((f) => join(dir, ...f.path.split('/')))) })
    return files
  }

  /** Walked again the next time (what is left out changed: a `.gitignore`, the project's kind). */
  forget(root: string): void {
    this.cache.delete(root)
  }

  /** Every root walked again when next asked (memory let go, ADR-007). */
  clear(): void {
    this.cache.clear()
  }

  /** Files changed on disk under a root: walked again only if one came or went. */
  changed(root: string, paths: string[]): void {
    const hit = this.cache.get(root)
    if (!hit) return
    for (const p of paths) {
      const listed = hit.known.has(p)
      if (listed !== existsSync(p) || (!listed && kindOf(p) !== 'other')) {
        this.cache.delete(root)
        return
      }
    }
  }
}

async function walk(root: string, dir: string, visibility: Visibility): Promise<IndexedFile[]> {
  const out: IndexedFile[] = []
  const queue = [dir]
  while (queue.length > 0 && out.length < MAX_FILES) {
    const current = queue.shift()!
    let items
    try {
      items = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const item of items) {
      const full = join(current, item.name)
      const isDir = item.isDirectory()
      if (!visibility.indexed(item.name, full, isDir)) continue
      if (isDir) queue.push(full)
      else if (item.isFile()) {
        const kind = kindOf(item.name)
        if (kind !== 'other') out.push({ root, path: relative(dir, full).split(sep).join('/'), kind })
      }
    }
  }
  return out
}
