import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

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
    await expect(rail.getByTestId('mode')).toHaveAttribute('data-mode', 'read')
    // One button goes round the modes; a right click picks one.
    const seen: (string | null)[] = []
    for (let i = 0; i < 4; i++) {
      await rail.getByTestId('mode').click()
      await expect(rail.getByTestId('mode')).not.toHaveAttribute('data-mode', seen.at(-1) ?? 'read')
      seen.push(await rail.getByTestId('mode').getAttribute('data-mode'))
    }
    expect(seen).toEqual(['visual', 'source', 'split', 'read'])
    await rail.getByTestId('mode').click({ button: 'right' })
    await win.getByTestId('mode-pick-split').click()
    await expect(rail.getByTestId('mode')).toHaveAttribute('data-mode', 'split')
    await viewMode(win, 'read')

    // Visual: the editor's toolbar in the floating bar, no mode buttons of the editor's own.
    await viewMode(win, 'visual')
    const bar = doc.getByTestId('doc-toolbar')
    await expect(bar.locator('.dsk-wysiwyg-toolbar')).toBeVisible()
    await expect(doc.locator('dsk-markdown-editor .dsk-wysiwyg-toolbar')).toHaveCount(0)
    await expect(doc.locator('.dsk-md__modes')).toHaveCount(0)
    await expect(rail.getByTestId('mode')).toHaveAttribute('data-mode', 'visual')
    // The toolbar stays where it is as the page scrolls: at rest, a little down, far down.
    const toolbarY = async (scroll: number) => {
      await win.getByTestId('view').evaluate((v, y) => (v.scrollTop = y === -1 ? v.scrollHeight : y), scroll)
      await win.waitForTimeout(50)
      const box = await bar.locator('.dsk-wysiwyg-toolbar').boundingBox()
      const view = await win.getByTestId('view').boundingBox()
      return Math.round(box!.y - view!.y)
    }
    const rest = await toolbarY(0)
    expect(rest).toBeGreaterThan(0)
    expect(rest).toBeLessThan(40)
    expect(await toolbarY(5)).toBe(rest)
    expect(await toolbarY(300)).toBe(rest)
    expect(await toolbarY(-1)).toBe(rest)

    // Markdown and side by side, from the rail; reading again.
    await viewMode(win, 'source')
    await expect(doc.locator('dsk-markdown-editor textarea')).toBeVisible()
    await expect(bar).toBeHidden()
    // Edge to edge: the whole workspace, no frame, the page itself not scrolling (the text does).
    const fill = async () =>
      win.evaluate(() => {
        const view = document.querySelector('[data-testid="view"]')!.getBoundingClientRect()
        const area = document.querySelector('article.doc:not([hidden]) .dsk-md__source')!
        const r = area.getBoundingClientRect()
        const preview = document.querySelector('article.doc:not([hidden]) .dsk-md__preview')
        const p = preview?.getBoundingClientRect()
        const v = document.querySelector('[data-testid="view"]')!
        return {
          left: Math.round(r.left - view.left),
          right: Math.round((p ?? r).right - view.right),
          top: Math.round(r.top - view.top),
          bottom: Math.round(r.bottom - view.bottom),
          border: getComputedStyle(area).borderTopWidth,
          viewScrolls: v.scrollHeight > v.clientHeight + 1,
          seam: p ? { gap: Math.round(p.left - r.right), line: getComputedStyle(preview!).borderLeftWidth } : null,
        }
      })
    expect(await fill()).toEqual({ left: 0, right: 0, top: 0, bottom: 0, border: '0px', viewScrolls: false, seam: null })
    await viewMode(win, 'split')
    await expect(doc.locator('.dsk-md--split')).toBeVisible()
    // Side by side: two halves meeting at a line.
    expect(await fill()).toEqual({ left: 0, right: 0, top: 0, bottom: 0, border: '0px', viewScrolls: false, seam: { gap: 0, line: '1px' } })
    await viewMode(win, 'read')
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
