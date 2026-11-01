import { join } from 'node:path'
import { readJson, writeJson } from './jsonFile'

/**
 * What was open, to come back to after a restart (ADR-001). Unsaved buffers
 * and notes join it with editing (stage 3); the list of documents and the
 * active one are here from the start.
 */
export interface SessionData {
  version: 1
  documents: { path: string }[]
  active: string | null
}

export class Session {
  private data: SessionData

  constructor(private readonly dataDir: string) {
    const loaded = readJson<Partial<SessionData>>(this.file(), {})
    this.data = { version: 1, documents: loaded.documents ?? [], active: loaded.active ?? null }
  }

  private file(): string {
    return join(this.dataDir, 'session', 'session.json')
  }

  documents(): string[] {
    return this.data.documents.map((d) => d.path)
  }

  active(): string | null {
    return this.data.active
  }

  set(documents: string[], active: string | null): void {
    this.data = { version: 1, documents: documents.map((path) => ({ path })), active }
    writeJson(this.file(), this.data)
  }
}
