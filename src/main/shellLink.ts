/**
 * The shell terminal (https://github.com/dskripchenko/shell), when it runs:
 * found by the presence file it leaves (`shell-presence.json` in the user's
 * runtime or temporary folder — the user's own, of a live process) and asked
 * over its local API: a tab opened in a folder, the review's comments pasted
 * into the agent's pane of a repository, a review waiting shown on its tabs.
 */
import { readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ShellLink {
  url: string
  token: string
  capabilities: string[]
}

export interface FindShell {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  uid?: number
  tmp?: string
  read?: (path: string) => string
  owner?: (path: string) => number | null
  alive?: (pid: number) => boolean
}

const ownerOf = (path: string): number | null => {
  try {
    return statSync(path).uid
  } catch {
    return null
  }
}
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function shellPresencePath(env: NodeJS.ProcessEnv, tmp: string = tmpdir()): string {
  return env.SHELL_PRESENCE || join(env.XDG_RUNTIME_DIR || tmp, 'shell-presence.json')
}

/** The running shell's API, or null. */
export function findShell(input: FindShell): ShellLink | null {
  const path = shellPresencePath(input.env, input.tmp)
  if (input.platform !== 'win32' && input.uid !== undefined && (input.owner ?? ownerOf)(path) !== input.uid) return null
  try {
    const p = JSON.parse((input.read ?? ((x: string) => readFileSync(x, 'utf8')))(path)) as Record<string, unknown>
    if (!Number.isInteger(p.pid) || typeof p.url !== 'string' || typeof p.token !== 'string') return null
    // Only a local address: the token is never sent anywhere else.
    if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(p.url)) return null
    if (!(input.alive ?? isAlive)(p.pid as number)) return null
    const capabilities = Array.isArray(p.capabilities) ? p.capabilities.filter((c): c is string => typeof c === 'string') : []
    return { url: p.url, token: p.token, capabilities }
  } catch {
    return null
  }
}

/** A request to shell's API: its status and its JSON body, if any; 0 when shell did not answer. */
export async function askShell(link: ShellLink, path: string, body: object): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const r = await fetch(link.url + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${link.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    })
    const text = await r.text()
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null
    } catch {
      parsed = null
    }
    return { status: r.status, body: parsed }
  } catch {
    return { status: 0, body: null }
  }
}
