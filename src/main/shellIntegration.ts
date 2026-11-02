/**
 * Shell integration: small scripts that make a console's shell mark its
 * commands — a prompt, the command, its output, its exit code (OSC 133, with
 * the command's text as VS Code's 633;E) — and say its folder (OSC 7). The
 * user's own startup files run first, as they would in a terminal app; the
 * marks are added after. zsh, bash and PowerShell; any other shell runs as is.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import bash from './shell/folio.bash'
import powershell from './shell/folio.ps1'
import zshWrap from './shell/zshwrap.zsh'
import zshrc from './shell/zshrc.zsh'

export interface Launch {
  args: string[]
  env: Record<string, string>
}

const ZSH_WRAP = (file: string): string => zshWrap.split('__FILE__').join(file)

/**
 * How to start a shell with folio's marks: arguments and environment added to
 * its usual start. Null for a shell folio has no script for, or when the user
 * turned it off (`FOLIO_SHELL_INTEGRATION=0`).
 */
export function integrate(shell: string, args: string[], dir: string, env: NodeJS.ProcessEnv = process.env): Launch | null {
  if (env.FOLIO_SHELL_INTEGRATION === '0') return null
  const name = basename(shell).toLowerCase().replace(/\.exe$/, '')
  try {
    if (name === 'zsh') {
      const zdot = join(dir, 'zsh')
      mkdirSync(zdot, { recursive: true })
      writeFileSync(join(zdot, '.zshenv'), ZSH_WRAP('.zshenv'))
      writeFileSync(join(zdot, '.zprofile'), ZSH_WRAP('.zprofile'))
      writeFileSync(join(zdot, '.zshrc'), ZSH_WRAP('.zshrc') + zshrc)
      return { args, env: { ZDOTDIR: zdot, FOLIO_USER_ZDOTDIR: env.ZDOTDIR || env.HOME || '' } }
    }
    if (name === 'bash') {
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'folio.bash')
      writeFileSync(file, bash)
      // Interactive with folio's file in place of ~/.bashrc; it reads the login files itself.
      return { args: ['--init-file', file, '-i'], env: {} }
    }
    if (name === 'powershell' || name === 'pwsh') {
      // As an encoded command, not a script file: the execution policy does not stop it.
      const encoded = Buffer.from(powershell, 'utf16le').toString('base64')
      return { args: [...args.filter((a) => a !== '-NoExit'), '-NoExit', '-EncodedCommand', encoded], env: {} }
    }
  } catch {
    // The folder cannot be written: the shell runs without the marks.
  }
  return null
}
