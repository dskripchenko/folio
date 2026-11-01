import { join } from 'node:path'
import { readJson, writeJson } from './jsonFile'

/**
 * What was open, to come back to after a restart: the tabs — a file, a
 * buffer (an unsaved edit of a file, or a quick note) — and the active one.
 */
export interface SessionTab {
  path: string | null
  buffer: string | null
}

export interface SessionData {
  version: 2
  tabs: SessionTab[]
  /** The index of the active tab. */
  active: number | null
}

interface V1 {
  documents?: { path: string }[]
  active?: string | null
}

export class Session {
  private data: SessionData

  constructor(private readonly dataDir: string) {
    const loaded = readJson<Partial<SessionData> & V1>(this.file(), {})
    if (loaded.version === 2 && Array.isArray(loaded.tabs)) {
      this.data = { version: 2, tabs: loaded.tabs, active: loaded.active ?? null }
    } else {
      // Version 1: a list of files and the active path.
      const docs = (loaded.documents ?? []).map((d) => d.path)
      const active = typeof loaded.active === 'string' ? docs.indexOf(loaded.active) : -1
      this.data = { version: 2, tabs: docs.map((path) => ({ path, buffer: null })), active: active >= 0 ? active : null }
    }
  }

  private file(): string {
    return join(this.dataDir, 'session', 'session.json')
  }

  tabs(): SessionTab[] {
    return this.data.tabs.map((t) => ({ ...t }))
  }

  active(): number | null {
    return this.data.active
  }

  set(tabs: SessionTab[], active: number | null): void {
    this.data = { version: 2, tabs: tabs.map((t) => ({ path: t.path, buffer: t.buffer })), active }
    writeJson(this.file(), this.data)
  }
}
