import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('the changes panel: a save is not committed in a code project; staged, committed with a message, a file thrown away', async () => {
  const f = fixture()
  const proj = join(f.root, 'lib')
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "lib" }\n')
  writeFileSync(join(proj, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(proj, 'src', 'b.ts'), 'export const b = 2\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: proj, encoding: 'utf8' })
  git('init', '-q')
  git('-c', 'user.name=T', '-c', 'user.email=t@example.com', 'add', '.')
  git('-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-qm', 'start')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data, FOLIO_COMMIT_PAUSE: '200' } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      // Discarding asks first: the first button, as if chosen.
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'lib' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'src' }).click()
    await project.locator('.tree .row', { hasText: 'a.ts' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await viewMode(win, 'visual')
    await doc.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+End`)
    await win.keyboard.type('export const c = 3\n')
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /a\.ts/ })).not.toHaveClass(/dirty/)
    // A code project: the save is not committed on its own.
    await win.waitForTimeout(600)
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1)

    // Ctrl+Shift+G on every system: the changes.
    await win.keyboard.press('Control+Shift+G')
    const panel = win.getByTestId('changes-panel')
    await expect(panel).toBeVisible()
    const unstaged = panel.getByTestId('changes-unstaged')
    await expect(unstaged.getByTestId('change')).toHaveCount(1)
    await expect(unstaged.getByTestId('change')).toHaveAttribute('data-path', 'src/a.ts')

    // b.ts changed on disk too, then thrown away from the panel.
    writeFileSync(join(proj, 'src', 'b.ts'), 'broken\n')
    await expect(unstaged.getByTestId('change')).toHaveCount(2)
    const b = unstaged.locator('[data-path="src/b.ts"]')
    await b.getByTestId('change-discard').click()
    await expect(unstaged.getByTestId('change')).toHaveCount(1)
    expect(readFileSync(join(proj, 'src', 'b.ts'), 'utf8')).toBe('export const b = 2\n')

    // Staged, then committed with a message by Cmd/Ctrl+Enter.
    const a = unstaged.locator('[data-path="src/a.ts"]')
    await a.getByTestId('change-stage').click()
    await expect(panel.getByTestId('changes-staged').getByTestId('change')).toHaveCount(1)
    await panel.getByTestId('changes-message').fill('Add c')
    await panel.getByTestId('changes-message').press(`${mod}+Enter`)
    await expect(panel.getByTestId('changes-status')).toContainText(/Committed|Коммит/)
    await expect(panel.getByTestId('change')).toHaveCount(0)
    expect(git('log', '-1', '--format=%s').trim()).toBe('Add c')
    expect(git('status', '--porcelain')).toBe('')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
