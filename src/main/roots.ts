import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { resolveInside } from './paths'

/**
 * The folders a document may read from, by id: `folio://app/r/<id>/<path>`.
 * An id is derived from the folder, so it is stable across runs (links in a
 * restored session keep working) and says nothing about the path.
 */
export class Roots {
  private readonly dirs = new Map<string, string>()

  static idOf(dir: string): string {
    return createHash('sha256').update(resolve(dir)).digest('hex').slice(0, 16)
  }

  register(dir: string): string {
    const id = Roots.idOf(dir)
    this.dirs.set(id, resolve(dir))
    return id
  }

  dir(id: string): string | undefined {
    return this.dirs.get(id)
  }

  /** The real file for a request, or null: an unknown root, or a path leaving it. */
  resolve(id: string, rel: string): string | null {
    const dir = this.dirs.get(id)
    return dir === undefined ? null : resolveInside(dir, rel)
  }
}
