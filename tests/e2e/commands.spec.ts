import { _electron as electron, expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('the commands: found by name, run with Enter, the last used first; the ones that cannot run now not offered', async () => {
  const f = fixture()
  const doc = join(f.folder, 'note.md')
  writeFileSync(doc, '# Note\n')
  const app = await electron.launch({ args: ['.', doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Note' })).toBeVisible()
    const palette = win.getByTestId('command-palette')
    const input = win.getByTestId('command-input')
    const items = palette.getByTestId('command-item')

    // Cmd/Ctrl+K: letters in order find a command; Enter runs it.
    await win.keyboard.press(`${mod}+k`)
    await expect(input).toBeFocused()
    await input.fill('mrkdwn')
    await expect(items.first()).toHaveAttribute('data-command', 'mode-source')
    await win.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(pane.locator('textarea.dsk-md__source')).toBeVisible()

    // F1 opens it too; a mode that is on is not offered; the command used last comes first.
    await win.keyboard.press('F1')
    await expect(palette.locator('[data-command="mode-source"]')).toHaveCount(0)
    await palette.locator('[data-command="theme-dark"]').click()
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark')
    await win.keyboard.press('F1')
    await palette.locator('[data-command="links"]').click()
    await expect(win.getByTestId('links-panel')).toBeVisible()
    await win.keyboard.press('F1')
    await expect(items.first()).toHaveAttribute('data-command', 'links')

    // A command shows its keys; with no document, saving is not offered.
    const closeTab = palette.locator('[data-command="close-tab"]')
    await expect(closeTab.locator('kbd')).toHaveText(/⌘W|Ctrl\+W/)
    await closeTab.click()
    await expect(win.getByRole('tab', { name: /note\.md/ })).toHaveCount(0)
    await win.keyboard.press('F1')
    await expect(palette.locator('[data-command="save"]')).toHaveCount(0)
    await expect(palette.locator('[data-command="go-to-file"]')).toHaveCount(1)
    await win.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  } finally {
    await app.close()
  }
})
