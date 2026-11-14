/**
 * Shell integration (ADR-007): zsh, bash and PowerShell mark their commands
 * (OSC 133, 633;E) and say their folder (OSC 7), the user's own startup files
 * first — from @dskripchenko/shell-integration, shared with the shell
 * terminal. `FOLIO_SHELL_INTEGRATION=0` (as before) or `SHELL_INTEGRATION=0`
 * turns it off.
 */
import { integrate as integrateShell, type Launch } from '@dskripchenko/shell-integration'

export type { Launch }

export function integrate(shell: string, args: string[], dir: string, env: NodeJS.ProcessEnv = process.env): Launch | null {
  if (env.FOLIO_SHELL_INTEGRATION === '0') return null
  return integrateShell(shell, args, dir, env)
}
