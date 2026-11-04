import { renameSync } from 'node:fs'

/**
 * Windows lets another program hold a file for a moment — an antivirus or the
 * search indexer reading one just made — and a rename then fails with EPERM,
 * EACCES or EBUSY. Tried again for a little while, as graceful-fs does; other
 * errors, and every error elsewhere, at once.
 */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

export function whileBusy<T>(op: () => T, o: { platform?: NodeJS.Platform; ms?: number } = {}): T {
  const platform = o.platform ?? process.platform
  const until = Date.now() + (o.ms ?? 2000)
  let wait = 10
  for (;;) {
    try {
      return op()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (platform !== 'win32' || !code || !BUSY.has(code) || Date.now() >= until) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
      wait = Math.min(wait * 2, 200)
    }
  }
}

/** `renameSync`, tried again while the file is held (Windows). */
export function renameWhileBusy(from: string, to: string): void {
  whileBusy(() => renameSync(from, to))
}
