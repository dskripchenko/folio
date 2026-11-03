/**
 * Consoles: the user's shell in a pseudo-terminal, one per console tab, in
 * the folder it was opened for. What the shell writes is gathered for a few
 * milliseconds and sent to the window in one message (a `cat` of a big file
 * is thousands of pieces); what the window sends goes to the shell as typed.
 */
import { chmodSync, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IPty } from 'node-pty'
import { integrate } from './shellIntegration'

export interface ConsoleSink {
  data(id: number, data: string): void
  exit(id: number, code: number): void
}

/** The shell people use: theirs on macOS and Linux, PowerShell on Windows. */
export function shellOf(env = process.env, platform = process.platform, exists: (path: string) => boolean = existsSync): { file: string; args: string[] } {
  if (platform === 'win32') return { file: env.COMSPEC && /pwsh|powershell/i.test(env.COMSPEC) ? env.COMSPEC : 'powershell.exe', args: ['-NoLogo'] }
  const file = env.SHELL && exists(env.SHELL) ? env.SHELL : exists('/bin/zsh') && platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  // A login shell, as a terminal app opens: the profile's PATH and settings.
  return { file, args: /(?:ba|z|fi|k)sh$/.test(file) ? ['-l'] : [] }
}

/** A shell's arguments to run one command and end: `-l -c` for a POSIX shell, `-Command` for PowerShell. */
export function commandArgs(shell: { file: string; args: string[] }, command: string): string[] {
  if (/pwsh|powershell/i.test(shell.file)) return [...shell.args, '-NoProfile', '-Command', command]
  if (/cmd(\.exe)?$/i.test(shell.file)) return ['/d', '/s', '/c', command]
  return [...shell.args, '-c', command]
}

/**
 * node-pty's helper on macOS comes out of the package without the right to
 * run (npm and pnpm drop it): given back before the first console.
 */
function fixSpawnHelper(): void {
  if (process.platform !== 'darwin') return
  try {
    const root = dirname(require.resolve('node-pty/package.json'))
    for (const dir of [join(root, 'prebuilds', `darwin-${process.arch}`), join(root, 'build', 'Release')]) {
      const helper = join(dir, 'spawn-helper')
      if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755)
    }
  } catch {
    // Not where expected: spawning says so.
  }
}

/**
 * The environment a shell starts with: the user's, without what the way folio
 * itself was started put there — Electron's variables, and npm's or pnpm's
 * when folio runs from `pnpm start` (`npm_config_prefix` makes nvm refuse to
 * load, a node's `PATH` of the package's bin folders shadows the user's tools).
 */
export function shellEnv(from: NodeJS.ProcessEnv, platform = process.platform): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(from)) {
    if (v === undefined || /^(ELECTRON_|npm_|NPM_|PNPM_|pnpm_)/.test(k) || k === 'INIT_CWD' || k === 'NODE' || k === 'NODE_OPTIONS' || k === 'NODE_PATH') continue
    env[k] = v
  }
  // Package managers put the package's own bin folders first in PATH: the shell gets the user's.
  const path = env.PATH ?? env.Path
  if (path) {
    const sep = platform === 'win32' ? ';' : ':'
    const kept = path.split(sep).filter((d) => !/[\\/]node_modules[\\/]\.bin$|[\\/]node-gyp-bin$/.test(d))
    if (env.PATH) env.PATH = kept.join(sep)
    else env.Path = kept.join(sep)
  }
  return env
}

export class Consoles {
  private readonly ptys = new Map<number, IPty>()
  private next = 1
  private fixed = false

  constructor(
    private readonly sink: ConsoleSink,
    /** Where the shell integration's scripts are written (folio's data folder). */
    private readonly scripts: string,
  ) {}

  /**
   * A shell in a folder; its id, or an error people can read. With a command
   * (a task), the shell runs it and ends with it: its exit code is the task's.
   */
  open(cwd: string, cols: number, rows: number, command?: string): { id: number } | { error: string } {
    if (!this.fixed) {
      fixSpawnHelper()
      this.fixed = true
    }
    // Loaded at the first console: a window that never opens one does not load a native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pty = require('node-pty') as typeof import('node-pty')
    const shell = shellOf()
    const env = shellEnv(process.env)
    const integration = command === undefined ? integrate(shell.file, shell.args, this.scripts, env) : null
    const file = shell.file
    const args = command !== undefined ? commandArgs(shell, command) : (integration?.args ?? shell.args)
    if (integration) Object.assign(env, integration.env)
    Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'folio' })
    env.LANG ??= 'en_US.UTF-8'
    let p: IPty
    try {
      p = pty.spawn(file, args, { name: 'xterm-256color', cols: Math.max(2, cols), rows: Math.max(1, rows), cwd: existsSync(cwd) ? cwd : homedir(), env, useConpty: true })
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
    const id = this.next++
    this.ptys.set(id, p)
    let pending = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    p.onData((data) => {
      pending += data
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const out = pending
        pending = ''
        this.sink.data(id, out)
      }, 8)
    })
    p.onExit(({ exitCode }) => {
      if (timer) clearTimeout(timer)
      if (pending) this.sink.data(id, pending)
      this.ptys.delete(id)
      this.sink.exit(id, exitCode)
    })
    return { id }
  }

  write(id: number, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    try {
      this.ptys.get(id)?.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)))
    } catch {
      // The shell has just ended.
    }
  }

  close(id: number): void {
    const p = this.ptys.get(id)
    this.ptys.delete(id)
    try {
      p?.kill()
    } catch {
      // Gone already.
    }
  }

  closeAll(): void {
    for (const id of [...this.ptys.keys()]) this.close(id)
  }
}
