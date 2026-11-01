import { join, resolve } from 'node:path'
import { readJson, writeJson } from './jsonFile'
import { isInside } from './paths'

/**
 * What may reach the network (ADR-001): a document opens without it; the
 * user allows it for that file or for its folder (with everything inside).
 */
export interface ConsentData {
  files: string[]
  folders: string[]
}

export class Consent {
  private data: ConsentData

  constructor(private readonly dataDir: string) {
    const loaded = readJson<Partial<ConsentData>>(this.file(), {})
    this.data = { files: loaded.files ?? [], folders: loaded.folders ?? [] }
  }

  private file(): string {
    return join(this.dataDir, 'consent.json')
  }

  allows(file: string): boolean {
    const full = resolve(file)
    return this.data.files.includes(full) || this.data.folders.some((dir) => isInside(dir, full))
  }

  allow(scope: 'file' | 'folder', path: string): void {
    const list = scope === 'file' ? this.data.files : this.data.folders
    const full = resolve(path)
    if (!list.includes(full)) list.push(full)
    writeJson(this.file(), this.data)
  }

  revoke(path: string): void {
    const full = resolve(path)
    this.data.files = this.data.files.filter((p) => p !== full)
    this.data.folders = this.data.folders.filter((p) => p !== full)
    writeJson(this.file(), this.data)
  }
}
