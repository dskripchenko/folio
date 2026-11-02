import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('tags and properties: the properties drawn, tags as chips, the tags panel with nested tags, a chip opening it', async () => {
  const f = fixture()
  const proj = join(f.root, 'garden')
  mkdirSync(join(proj, 'notes'), { recursive: true })
  writeFileSync(join(proj, 'Plan.md'), '---\ntitle: The plan\ntags: [work]\n---\n\n# Plan\n\nDue soon #work/urgent, see C# and #123.\n')
  writeFileSync(join(proj, 'notes', 'Home.md'), '# Home\n\nFix the door #home and #work.\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
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
    await project.locator('.tree .row', { hasText: 'Plan.md' }).click()

    // Reading: the properties as a table, the tags as chips; C# and #123 stay text.
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('table.uid-markdown__props th', { hasText: 'title' })).toBeVisible()
    await expect(pane.locator('.uid-markdown__tag')).toHaveText(['#work', '#work/urgent'])

    // The panel: the project's tags, nested ones under their parent, with the number of notes.
    await win.getByTestId('toggle-tags').click()
    const panel = win.getByTestId('tags-panel')
    const rows = panel.getByTestId('tags-row')
    await expect(rows).toHaveText(['#home1', '#work2'])
    await rows.filter({ hasText: '#work' }).click()
    await expect(rows).toHaveText(['#home1', '#work2', '#urgent1'])
    await expect(panel.getByTestId('tags-note')).toHaveText(['Home', 'Plan'])

    // A filter: the matching tags, flat.
    await panel.getByTestId('tags-filter').fill('urg')
    await expect(rows).toHaveText(['#work/urgent1'])
    await panel.getByTestId('tags-filter').fill('')

    // A chip in the document opens the panel on its tag; a note opens from it.
    await panel.getByTestId('tags-close').click()
    await pane.locator('.uid-markdown__tag', { hasText: '#work/urgent' }).click()
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-tag="work/urgent"]')).toHaveAttribute('aria-expanded', 'true')
    await panel.locator('.tags-item', { has: win.locator('[data-tag="work"]') }).getByTestId('tags-note').filter({ hasText: 'Home' }).click()
    await expect(win.getByRole('tab', { name: /Home\.md/ })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await app.close()
  }
})
