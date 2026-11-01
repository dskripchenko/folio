import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('go to a file by its name: every project, ranked as typed; a new file is found too', async () => {
  const f = fixture()
  mkdirSync(join(f.folder, 'deep', 'er'), { recursive: true })
  writeFileSync(join(f.folder, 'deep', 'er', 'release-notes.md'), '# Release notes\n')
  writeFileSync(join(f.folder, 'deep', 'config.yaml'), 'a: 1\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [f.folder])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    await expect(win.getByTestId('projects').locator('.project', { hasText: 'notes' })).toBeVisible()

    await win.keyboard.press(`${mod}+t`)
    const palette = win.getByTestId('go-to-file')
    await expect(palette).toBeVisible()
    await expect(win.getByTestId('go-to-file-input')).toBeFocused()
    const items = palette.getByTestId('go-to-file-item')
    // Initials: r(elease)n(otes).
    await win.getByTestId('go-to-file-input').fill('rn')
    await expect(items.first()).toHaveAttribute('data-path', 'deep/er/release-notes.md')
    await expect(items.first().locator('b').first()).toHaveText('r')
    // Code and data files are there too; the arrows choose, Enter opens.
    await win.getByTestId('go-to-file-input').fill('conf')
    await expect(items.first()).toHaveAttribute('data-path', 'deep/config.yaml')
    await win.getByTestId('go-to-file-input').fill('oth')
    await expect(items.first()).toHaveAttribute('data-path', 'other.md')
    await win.getByTestId('go-to-file-input').press('Enter')
    await expect(palette).toBeHidden()
    await expect(win.getByRole('tab', { name: /other\.md/ })).toHaveAttribute('aria-selected', 'true')

    // A file made on disk afterwards: listed the next time.
    writeFileSync(join(f.folder, 'fresh-idea.md'), '# Fresh\n')
    await win.waitForTimeout(600)
    await win.keyboard.press(`${mod}+t`)
    await win.getByTestId('go-to-file-input').fill('fresh')
    await expect(items.first()).toHaveAttribute('data-path', 'fresh-idea.md')
    await win.getByTestId('go-to-file-input').fill('zzzz-nothing')
    await expect(palette.locator('.palette-note')).toBeVisible()
    await win.getByTestId('go-to-file-input').press('Escape')
    await expect(palette).toBeHidden()
  } finally {
    await app.close()
  }
})
