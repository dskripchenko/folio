import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('Claude Code connected: its hook in the local settings; its edits signed in the review and the worktrees; disconnected', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(proj, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: proj, encoding: 'utf8' })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'a.ts'), 'export const a = 1\n')
  mkdirSync(join(proj, '.claude'))
  writeFileSync(join(proj, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }))
  git('init', '-q', '--initial-branch=main')
  git('config', 'core.autocrlf', 'false')
  git('add', 'package.json', 'a.ts')
  git('commit', '-qm', 'start')
  const settings = () => JSON.parse(readFileSync(join(proj, '.claude', 'settings.local.json'), 'utf8'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'package.json' }).click()

    // Connected from the commands: the hook beside the settings there were.
    await win.keyboard.press(`${mod}+k`)
    await win.keyboard.type('Claude')
    await win.locator('[data-command="claude-connect"]').click()
    await expect.poll(() => JSON.stringify(settings())).toContain('folio-review-events')
    expect(settings().permissions).toEqual({ allow: ['Bash(ls)'] })
    const command: string = settings().hooks.PostToolUse[0].hooks[0].command

    // Claude Code edits a.ts, and its hook tells folio.
    writeFileSync(join(proj, 'a.ts'), 'export const a = 2\n')
    const input = JSON.stringify({ session_id: 'c0ffee42-session', cwd: proj, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(proj, 'a.ts') } })
    if (process.platform === 'win32') {
      const events = /'([^']+)' # folio-review-events$/.exec(command)![1]!
      appendFileSync(events, `{"t":${Math.floor(Date.now() / 1000)},"e":${input}}\n`)
    } else execFileSync('bash', ['-c', command], { input })

    // Signed in the review, and in the worktrees.
    await win.getByTestId('toggle-changes').click()
    await win.getByTestId('changes-review').click()
    const a = win.locator('[data-testid="review"]:visible [data-path="a.ts"]')
    await expect(a.getByTestId('review-agent')).toHaveText('Claude · c0ffee42')
    await win.getByTestId('toggle-worktrees').click()
    await expect(win.getByTestId('worktrees-panel').getByTestId('worktree-agent').first()).toHaveText(/Claude · c0ffee42/)

    // Disconnected: the hook gone, the rest kept.
    await win.keyboard.press(`${mod}+k`)
    await win.keyboard.type('Claude')
    await win.locator('[data-command="claude-disconnect"]').click()
    await expect.poll(() => JSON.stringify(settings())).not.toContain('folio-review-events')
    expect(settings()).toEqual({ permissions: { allow: ['Bash(ls)'] } })
  } finally {
    await app.close()
  }
})
