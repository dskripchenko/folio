import { join } from 'node:path'
import { readJson, writeJson } from './jsonFile'
import type { Login } from './sync'

/**
 * Logins for HTTPS remotes when folio syncs without the system git (ADR-001,
 * stage 4b), by host. Kept encrypted by the system (Electron's safeStorage:
 * Keychain, DPAPI, the Secret Service); where the system offers no
 * encryption, a login lives for the session only, never written in clear.
 */
export interface Cipher {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export const hostKey = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return url
  }
}

export class Logins {
  private readonly session = new Map<string, Login>()

  constructor(
    private readonly dataDir: string,
    private readonly cipher: Cipher,
  ) {}

  private file(): string {
    return join(this.dataDir, 'logins.json')
  }

  get(url: string): Login | undefined {
    const key = hostKey(url)
    const known = this.session.get(key)
    if (known) return known
    const saved = readJson<Record<string, string>>(this.file(), {})[key]
    if (!saved || !this.cipher.available()) return undefined
    try {
      const login = JSON.parse(this.cipher.decrypt(Buffer.from(saved, 'base64'))) as Login
      this.session.set(key, login)
      return login
    } catch {
      return undefined
    }
  }

  /** Remember a login; saved to disk only when asked and the system can encrypt it. Returns whether it was saved. */
  set(url: string, login: Login, remember: boolean): boolean {
    const key = hostKey(url)
    this.session.set(key, login)
    const all = readJson<Record<string, string>>(this.file(), {})
    delete all[key]
    const save = remember && this.cipher.available()
    if (save) all[key] = this.cipher.encrypt(JSON.stringify(login)).toString('base64')
    writeJson(this.file(), all)
    return save
  }

  forget(url: string): void {
    const key = hostKey(url)
    this.session.delete(key)
    const all = readJson<Record<string, string>>(this.file(), {})
    delete all[key]
    writeJson(this.file(), all)
  }
}
