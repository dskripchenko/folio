import { chmodSync, existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Terminal } from '@dskripchenko/terminal'
import { spawn } from 'node-pty'
import { shellEnv } from '../../src/main/pty'
import { integrate } from '../../src/main/shellIntegration'

// The helper of node-pty needs the right to run on macOS (as the app gives it).
if (process.platform === 'darwin') {
  const helper = join(dirname(require.resolve('node-pty/package.json')), 'prebuilds', `darwin-${process.arch}`, 'spawn-helper')
  if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A real shell with folio's integration: commands typed, the screen read back. */
async function run(shell: string, args: string[], lines: string[], extraEnv: Record<string, string> = {}): Promise<Terminal> {
  const dir = mkdtempSync(join(tmpdir(), 'folio-shell-'))
  const env = { ...shellEnv(process.env), ...extraEnv }
  const launch = integrate(shell, args, dir, env)!
  expect(launch).not.toBeNull()
  const term = new Terminal({ cols: 100, rows: 30 })
  const p = spawn(shell, launch.args, { name: 'xterm-256color', cols: 100, rows: 30, cwd: tmpdir(), env: { ...env, ...launch.env, TERM: 'xterm-256color' } })
  p.onData((d) => term.write(d))
  term.onData((d) => p.write(d))
  // Until the first prompt is marked.
  for (let i = 0; i < 300 && term.commands.length === 0; i++) await wait(100)
  const ended = () => term.commands.filter((c) => c.end !== undefined).length
  for (const line of lines) {
    const before = ended()
    p.write(line + '\r')
    // Until the command is marked ended and the next prompt is up (a slow machine — a Windows runner busy
    // with other tests — takes up to half a minute a command): a line typed before the prompt may be lost.
    for (let i = 0; i < 300 && (ended() <= before || term.commands.length <= before + 1); i++) await wait(100)
  }
  await wait(300)
  p.kill()
  return term
}

const shells: [string, string, string[]][] = [
  ['zsh', '/bin/zsh', ['-l']],
  ['bash', '/bin/bash', ['-l']],
  ['powershell', 'powershell.exe', ['-NoLogo']],
]

describe('shell integration on real shells', () => {
  for (const [name, path, args] of shells) {
    const present = name === 'powershell' ? process.platform === 'win32' : process.platform !== 'win32' && existsSync(path)
    it.skipIf(!present)(`${name}: commands marked with their exit codes and text; the folder followed`, async () => {
      const target = mkdtempSync(join(tmpdir(), 'folio-cd-'))
      const fail = name === 'powershell' ? 'cmd /c exit 3' : 'false'
      const ok = name === 'powershell' ? 'Write-Output ok' : 'echo ok'
      const term = await run(path, args, [fail, ok, `cd "${target}"`])
      const done = term.commands.filter((c) => c.end !== undefined)
      expect(done.map((c) => [c.text, c.exitCode === 0 ? 0 : 'fail'])).toEqual([
        [fail, 'fail'],
        [ok, 0],
        [`cd "${target}"`, 0],
      ])
      // The output is between its marks: `ok` on the row after the command.
      const echo = done[1]!
      expect(term.buffer.lines[echo.output! - term.trimmed]!.text()).toContain('ok')
      expect(term.cwd?.replace(/^\/([A-Za-z]:)/, '$1').toLowerCase().replace(/\\/g, '/')).toContain(target.split(/[\\/]/).pop()!.toLowerCase())
    }, 120_000)
  }
})

describe('bash without its history', () => {
  // A profile that turns history off (some CI images' do): the text comes from the command being run.
  it.skipIf(process.platform === 'win32' || !existsSync('/bin/bash'))('commands still marked with their text', async () => {
    const home = mkdtempSync(join(tmpdir(), 'folio-home-'))
    writeFileSync(join(home, '.bash_profile'), 'set +o history\n')
    const term = await run('/bin/bash', ['-l'], ['false', 'echo ok'], { HOME: home })
    const done = term.commands.filter((c) => c.end !== undefined)
    expect(done.map((c) => c.text)).toEqual(['false', 'echo ok'])
  }, 120_000)
})
