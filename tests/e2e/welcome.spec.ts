import { _electron as electron, expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('the welcome document: opened on the first start, read-only, its examples drawn; again from the empty window, in the language chosen', async () => {
  const f = fixture()
  const env = { ...process.env, FOLIO_DATA: f.data, FOLIO_WELCOME: '1' }
  let app = await electron.launch({ args: ['.'], env })
  try {
    let win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    // The first start: it opens by itself.
    await expect(pane.locator('h1').first()).toHaveText(/Welcome to folio|Добро пожаловать в folio/)
    // Its examples are drawn, not code: diagrams, a board, a calendar, formulas, the API.
    await expect(pane.locator('dsk-markdown svg').first()).toBeVisible({ timeout: 20_000 })
    await expect(pane.locator('.uid-kanban, [class*="kanban"]').first()).toBeAttached()
    await expect(pane.locator('math').first()).toBeAttached()
    // Read only: one mode, nothing to edit or save.
    await expect(win.getByTestId('mode')).toBeDisabled().catch(async () => expect(await win.getByTestId('mode').getAttribute('data-mode')).toBe('read'))
    await win.keyboard.press(`${mod}+e`)
    await expect(pane.locator('[contenteditable="true"]')).toHaveCount(0)
    // Not again on the next start.
    await app.close()
    app = await electron.launch({ args: ['.'], env })
    win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    // Closed, then opened from the empty window — in the language chosen now.
    for (const tab of await win.locator('.tabs [role="tab"]').all()) await tab.locator('.close').click()
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('language-en').click()
    await win.getByTestId('welcome-open').click()
    await expect(win.locator('article.doc:not([hidden]) h1').first()).toHaveText('Welcome to folio')
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('language-ru').click()
    await win.keyboard.press(`${mod}+w`)
    await win.getByTestId('welcome-open').click()
    await expect(win.locator('article.doc:not([hidden]) h1').first()).toHaveText('Добро пожаловать в folio')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
