/**
 * folio's presence: a small file in the person's runtime folder while folio
 * runs, so other programs (the shell terminal) find the running folio and
 * know how to hand it a file, a project or a review. Removed on exit.
 */
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** What the command line understands (see `launchRequest`). */
export const CAPABILITIES = ['open', 'line', 'project', 'review'] as const

export interface Presence {
  pid: number
  version: string
  /** The command that starts folio; arguments go after it. A running folio takes them over. */
  launch: string[]
  capabilities: readonly string[]
}

/** `$FOLIO_PRESENCE`, else the user's runtime folder (`$XDG_RUNTIME_DIR` on Linux) or temporary folder. */
export function presencePath(env: NodeJS.ProcessEnv, tmp: string = tmpdir()): string {
  return env.FOLIO_PRESENCE || join(env.XDG_RUNTIME_DIR || tmp, 'folio-presence.json')
}

export function writePresence(path: string, presence: Presence): void {
  try {
    writeFileSync(path, JSON.stringify(presence, null, 2), { mode: 0o600 })
  } catch {
    // Nothing found by others: folio itself works the same.
  }
}

/** Removed only when it is still this process's (another folio may have started since). */
export function removePresence(path: string, pid: number, read: (path: string) => string): void {
  try {
    if ((JSON.parse(read(path)) as Presence).pid === pid) rmSync(path, { force: true })
  } catch {
    // Gone already.
  }
}
