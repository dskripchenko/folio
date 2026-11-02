import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('the links panel: notes linking here, the note’s own links, mentions made links', async () => {
  const f = fixture()
  const proj = join(f.root, 'garden')
  mkdirSync(join(proj, 'notes'), { recursive: true })
  writeFileSync(join(proj, 'Plan.md'), '# Plan\n\nSee [[Ideas]] and [[Someday]].\n')
  writeFileSync(join(proj, 'notes', 'Ideas.md'), '# Ideas\n\nBack to [[Plan|the plan]].\n')
  writeFileSync(join(proj, 'Journal.md'), '# Journal\n\nWorked on the plan today.\n')
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
    await expect(win.getByRole('tab', { name: /Plan\.md/ })).toHaveAttribute('aria-selected', 'true')

    await win.getByTestId('toggle-links').click()
    const panel = win.getByTestId('links-panel')
    await expect(panel).toBeVisible()
    // Linked here: Ideas, with its line.
    const incoming = panel.getByTestId('links-incoming')
    await expect(incoming.locator('.links-file-name')).toHaveText(['Ideas'])
    await expect(incoming.locator('.links-preview b')).toHaveText('[[Plan|the plan]]')
    // Its own links: Ideas, and Someday missing.
    const outgoing = panel.getByTestId('links-outgoing')
    await expect(outgoing.locator('.links-target')).toHaveText(['Ideas', 'Someday'])
    await expect(outgoing.locator('.links-place.missing')).toHaveCount(1)
    // Named without a link: the journal; made a link in place.
    const mentions = panel.getByTestId('links-mentions')
    await expect(mentions.locator('.links-file-name')).toHaveText(['Journal'])
    await mentions.getByTestId('links-make').click()
    await expect.poll(() => readFileSync(join(proj, 'Journal.md'), 'utf8')).toBe('# Journal\n\nWorked on the [[Plan|plan]] today.\n')
    await expect(incoming.locator('.links-file-name')).toHaveText(['Ideas', 'Journal'])
    await expect(mentions.locator('.links-none')).toBeVisible()

    // A line clicked: its note opens.
    await incoming.locator('.links-place').first().click()
    await expect(win.getByRole('tab', { name: /Ideas\.md/ })).toHaveAttribute('aria-selected', 'true')
    // The panel follows the note in view.
    await expect(incoming.locator('.links-file-name')).toHaveText(['Plan'])
  } finally {
    await app.close()
  }
})
