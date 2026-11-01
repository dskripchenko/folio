import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './jsonFile'

/**
 * What is typed and not saved (ADR-001, as in Sublime Text): a quick note
 * without a file, or an edit of a file that has not reached it. Written to
 * folio-data/session/buffers as it is typed, so closing folio, a crash or a
 * restart of the computer loses nothing; the file itself changes only on Save.
 */
export interface Buffer {
  id: string
  /** The file it edits; null for a quick note. */
  path: string | null
  /** The text as it is now. */
  text: string
  /** The hash of the file's text the edit started from (to see the file changed meanwhile). */
  baseline: string | null
  mode: 'visual' | 'source' | 'split'
  scroll: number
  updatedAt: string
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function newBufferId(): string {
  return randomUUID()
}

export class Buffers {
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'session', 'buffers')
  }

  private file(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`Not a buffer id: ${id}`)
    return join(this.dir, `${id}.json`)
  }

  get(id: string): Buffer | null {
    try {
      return readJson<Buffer | null>(this.file(id), null)
    } catch {
      return null
    }
  }

  write(buffer: Buffer): void {
    writeJson(this.file(buffer.id), { ...buffer, updatedAt: new Date().toISOString() })
  }

  remove(id: string): void {
    try {
      rmSync(this.file(id), { force: true })
    } catch {
      // Not a buffer id: nothing to remove.
    }
  }

  /** Every buffer kept, newest first. */
  all(): Buffer[] {
    mkdirSync(this.dir, { recursive: true })
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson<Buffer | null>(join(this.dir, f), null))
      .filter((b): b is Buffer => b !== null && typeof b.id === 'string')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
