import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test("the window's controls: modes on the rail, the editor's toolbar floating over the page, settings, the collapsed sidebar", async () => {
  const f = fixture()
  const proj = join(f.root, 'handbook')
  mkdirSync(join(proj, 'guides'), { recursive: true })
  writeFileSync(join(proj, 'README.md'), '# Handbook\n\n' + 'Text. '.repeat(600) + '\n')
  writeFileSync(join(proj, 'guides', 'setup.md'), '# Setup\n')
  const app = await electron.launch({ args: ['.', join(proj, 'README.md')], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const doc = win.locator('article.doc:not([hidden])')
    await expect(doc.locator('dsk-markdown h1')).toHaveText('Handbook')
    const rail = win.getByTestId('rail-right')
    await expect(rail.getByTestId('mode-read')).toHaveAttribute('aria-checked', 'true')

    // Visual: the editor's toolbar in the floating bar, no mode buttons of the editor's own.
    await rail.getByTestId('mode-visual').click()
    const bar = doc.getByTestId('doc-toolbar')
    await expect(bar.locator('.dsk-wysiwyg-toolbar')).toBeVisible()
    await expect(doc.locator('dsk-markdown-editor .dsk-wysiwyg-toolbar')).toHaveCount(0)
    await expect(doc.locator('.dsk-md__modes')).toHaveCount(0)
    await expect(rail.getByTestId('mode-visual')).toHaveAttribute('aria-checked', 'true')
    // Far down the page, the toolbar is still in view.
    await win.getByTestId('view').evaluate((v) => (v.scrollTop = v.scrollHeight))
    const box = await bar.locator('.dsk-wysiwyg-toolbar').boundingBox()
    const view = await win.getByTestId('view').boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(view!.y)
    expect(box!.y).toBeLessThan(view!.y + 80)

    // Markdown and side by side, from the rail; reading again.
    await rail.getByTestId('mode-source').click()
    await expect(doc.locator('dsk-markdown-editor textarea')).toBeVisible()
    await expect(bar).toBeHidden()
    await rail.getByTestId('mode-split').click()
    await expect(doc.locator('.dsk-md--split')).toBeVisible()
    await rail.getByTestId('mode-read').click()
    await expect(doc.locator('dsk-markdown-editor')).toHaveCount(0)

    // Settings: the theme, remembered.
    await rail.getByTestId('rail-settings').click()
    await win.getByTestId('theme-dark').click()
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await win.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 17, 23)')

    // The sidebar collapsed to its rail: a project's tree slides out, a file opens, the tree goes.
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    await expect(win.getByTestId('projects').locator('.project-row')).toContainText('handbook')
    await win.getByTestId('side-collapse').click()
    await expect(win.getByTestId('sidebar')).toBeHidden()
    const left = win.getByTestId('rail-left')
    await expect(left.locator('.avatar')).toHaveText('HA')
    await left.locator('.rail-item', { has: win.locator('.avatar') }).click()
    const fly = win.getByTestId('flyout')
    await expect(fly).toBeVisible()
    await fly.locator('.row', { hasText: 'guides' }).click()
    await fly.locator('.row', { hasText: 'setup.md' }).click()
    await expect(fly).toBeHidden()
    await expect(win.getByRole('tab', { name: /setup\.md/ })).toHaveAttribute('aria-selected', 'true')
    // Collapsed after a restart too.
    await app.close()
    const again = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
    const w2 = await again.firstWindow()
    await expect(w2.getByTestId('rail-left')).toBeVisible()
    await expect(w2.locator('html')).toHaveAttribute('data-theme', 'dark')
    await w2.getByTestId('rail-expand').click()
    await expect(w2.getByTestId('sidebar')).toBeVisible()
    await again.close()
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
