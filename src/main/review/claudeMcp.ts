import { execFile } from 'node:child_process'
import { MCP_NAME } from '../../common/mcp'
import { commandArgs, shellEnv, shellOf } from '../pty'

/**
 * folio's MCP server added to Claude Code (R7) — by Claude Code's own command,
 * `claude mcp add`, in the repository, with the local scope: the person's own
 * settings for that project, nothing written into the repository. The command
 * runs in the person's login shell (where `claude` is found, as in a
 * terminal); when it cannot run, the person is shown the command instead.
 */

export interface BridgeLaunch {
  /** folio's executable, run as Node. */
  exe: string
  bridge: string
  info: string
}

/** A word for a POSIX shell or PowerShell: quoted when it must be. */
export function quote(word: string, powershell: boolean): string {
  if (/^[\w@%+=:,./\\-]+$/.test(word)) return word
  return powershell ? `'${word.replace(/'/g, "''")}'` : `'${word.replace(/'/g, `'\\''`)}'`
}

/** The command line that adds folio's server for one project. */
export function addCommand(launch: BridgeLaunch, powershell: boolean, claude = 'claude'): string {
  const q = (w: string) => quote(w, powershell)
  // On PowerShell a native program is run by `&`, and `--` passed as is.
  // The name comes before the options: `--env` takes any number of values, so
  // a name after it is read as one more variable and the command fails.
  return [powershell ? `& ${q(claude)}` : q(claude), 'mcp', 'add', MCP_NAME, '--scope', 'local', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', q(launch.exe), q(launch.bridge), q(launch.info)].join(' ')
}

export function removeCommand(powershell: boolean, claude = 'claude'): string {
  return [powershell ? `& ${quote(claude, true)}` : quote(claude, false), 'mcp', 'remove', '--scope', 'local', MCP_NAME].join(' ')
}

/** The command run in the person's shell, in the repository: whether it ran, and what it said. */
export function runInShell(command: (powershell: boolean) => string, cwd: string): Promise<{ ok: boolean; command: string; output: string }> {
  const shell = shellOf()
  const powershell = /pwsh|powershell/i.test(shell.file)
  const line = command(powershell)
  return new Promise((resolve) => {
    execFile(shell.file, commandArgs(shell, line), { cwd, env: shellEnv(process.env), timeout: 60_000, windowsHide: true }, (error, stdout, stderr) =>
      resolve({ ok: !error, command: line, output: `${stdout}${stderr}`.trim() }),
    )
  })
}
