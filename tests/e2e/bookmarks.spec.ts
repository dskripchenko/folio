import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('bookmarks: added from a tab and the commands, opened from the sidebar, following a rename, kept across a restart', async () => {
  const f = fixture()
  const proj = join(f.root, 'garden')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'Plan.md'), '# Plan\n')
  writeFileSync(join(proj, 'Ideas.md'), '# Ideas\n')
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  let app = await launch()
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'garden' })
    await project.locator('.project-row').click()
    await expect(win.getByTestId('bookmarks')).toHaveCount(0)

    // From a tab's menu, and from the commands.
    await project.locator('.tree .row', { hasText: 'Plan.md' }).click()
    await win.getByRole('tab', { name: /Plan\.md/ }).click({ button: 'right' })
    await win.getByTestId('tab-bookmark').click()
    const marks = win.getByTestId('bookmarks').getByTestId('bookmark')
    await expect(marks).toHaveText(['Plan'])
    await project.locator('.tree .row', { hasText: 'Ideas.md' }).click()
    await win.keyboard.press(`${mod}+k`)
    await win.locator('[data-command="bookmark"]').click()
    await expect(marks).toHaveText(['Plan', 'Ideas'])

    // A bookmark opens its file.
    await win.getByRole('tab', { name: /Plan\.md/ }).locator('.close').click()
    await marks.filter({ hasText: 'Plan' }).click()
    await expect(win.getByRole('tab', { name: /Plan\.md/ })).toHaveAttribute('aria-selected', 'true')

    // Renamed in the tree: the bookmark follows.
    const root = await project.locator('ul.tree').first().getAttribute('data-root')
    await app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows()[0]!.webContents.send('tree:rename', v), { root, rel: 'Plan.md' })
    await win.getByTestId('tree-name').fill('Roadmap.md')
    await win.getByTestId('tree-name').press('Enter')
    await expect(marks).toHaveText(['Roadmap', 'Ideas'])

    // Let go from its menu.
    await marks.filter({ hasText: 'Ideas' }).click({ button: 'right' })
    await win.getByTestId('unbookmark').click()
    await expect(marks).toHaveText(['Roadmap'])
  } finally {
    await app.close()
  }
  // Kept across a restart.
  app = await launch()
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('bookmarks').getByTestId('bookmark')).toHaveText(['Roadmap'])
  } finally {
    await app.close()
  }
})
