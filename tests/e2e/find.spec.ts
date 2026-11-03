import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode, type Fixture } from './fixture'

async function launch(f: Fixture, ...files: string[]): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({ args: ['.', ...files], env: { ...process.env, FOLIO_DATA: f.data } })
  const win = await app.firstWindow()
  return { app, win }
}

const pane = (win: Page) => win.locator('article.doc:not([hidden])')
const marks = (win: Page) => win.evaluate(() => [CSS.highlights.get('folio-find')?.size ?? 0, CSS.highlights.get('folio-find-current')?.size ?? 0])
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('find in the page: every match marked, stepped through, options; the page is not changed', async () => {
  const f = fixture()
  const doc = join(f.folder, 'find.md')
  writeFileSync(doc, '# Orders\n\nAn order is paid. Orders ship daily.\n\nПлатёж по заказу, платёж принят.\n\n- the ORDER list\n- reorder\n')
  const { app, win } = await launch(f, doc)
  try {
    await expect(pane(win).locator('h1', { hasText: 'Orders' })).toBeVisible()
    const html = await pane(win).innerHTML()
    await win.keyboard.press(`${mod}+f`)
    const bar = win.getByTestId('find-bar')
    await expect(bar).toBeVisible()
    await win.getByTestId('find-input').fill('order')
    // Orders, order, Orders, ORDER, reorder: five, the first current.
    await expect(win.getByTestId('find-count')).toHaveText(/^1 (of|из) 5$/)
    expect(await marks(win)).toEqual([5, 1])
    await win.getByTestId('find-input').press('Enter')
    await expect(win.getByTestId('find-count')).toHaveText(/^2 (of|из) 5$/)
    await win.getByTestId('find-input').press('Shift+Enter')
    await win.getByTestId('find-input').press('Shift+Enter')
    await expect(win.getByTestId('find-count')).toHaveText(/^5 (of|из) 5$/)
    // Case, whole word (letters of any script), regular expression.
    await win.getByTestId('find-caseSensitive').click()
    await expect(win.getByTestId('find-count')).toHaveText(/(of|из) 2$/)
    await win.getByTestId('find-caseSensitive').click()
    await win.getByTestId('find-wholeWord').click()
    await expect(win.getByTestId('find-count')).toHaveText(/(of|из) 2$/)
    await win.getByTestId('find-input').fill('платёж')
    await expect(win.getByTestId('find-count')).toHaveText(/(of|из) 2$/)
    await win.getByTestId('find-wholeWord').click()
    await win.getByTestId('find-regex').click()
    await win.getByTestId('find-input').fill('\\bord(er|ers)\\b')
    await expect(win.getByTestId('find-count')).toHaveText(/(of|из) 4$/)
    await win.getByTestId('find-input').fill('ord(')
    await expect(bar).toHaveClass(/invalid/)
    await win.getByTestId('find-regex').click()
    await win.getByTestId('find-input').fill('nothing like it')
    await expect(win.getByTestId('find-count')).toHaveText(/No matches|Не найдено/)
    // A match does not run from one paragraph into the next.
    await win.getByTestId('find-input').fill('daily.Платёж')
    await expect(win.getByTestId('find-count')).toHaveText(/No matches|Не найдено/)
    // The page as it was: marks are not markup.
    expect(await pane(win).innerHTML()).toBe(html)
    // The file changes on disk: searched again.
    await win.getByTestId('find-input').fill('order')
    writeFileSync(doc, '# Orders\n\nOne order.\n')
    await expect(win.getByTestId('find-count')).toHaveText(/(of|из) 2$/)
    // Escape closes and clears; Cmd+G (F3 off a Mac, where Ctrl+G goes to a line) opens it again.
    await win.getByTestId('find-input').press('Escape')
    await expect(bar).toBeHidden()
    expect(await marks(win)).toEqual([0, 0])
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+g' : 'F3')
    await expect(bar).toBeVisible()
    await expect(win.getByTestId('find-count')).toHaveText(/(of|из) 2$/)
  } finally {
    await app.close()
  }
})

test('find in the Markdown source: the match framed in the field, selected there on Escape', async () => {
  const f = fixture()
  const doc = join(f.folder, 'src.md')
  writeFileSync(doc, '# Title\n\n' + 'filler line\n'.repeat(80) + 'the needle is here\n')
  const { app, win } = await launch(f, doc)
  try {
    await expect(pane(win).locator('h1', { hasText: 'Title' })).toBeVisible()
    await viewMode(win, 'source')
    const area = pane(win).locator('textarea').first()
    await expect(area).toBeVisible()
    await win.keyboard.press(`${mod}+f`)
    await win.getByTestId('find-input').fill('needle')
    await expect(win.getByTestId('find-count')).toHaveText(/^1 (of|из) 1$/)
    const frame = win.locator('.find-frame')
    await expect(frame).toHaveCount(1)
    await expect(frame).toBeInViewport()
    await win.getByTestId('find-input').press('Escape')
    await expect(frame).toHaveCount(0)
    const sel = await area.evaluate((a: HTMLTextAreaElement) => a.value.slice(a.selectionStart, a.selectionEnd))
    expect(sel).toBe('needle')
    await expect(area).toBeFocused()
  } finally {
    await app.close()
  }
})

test('find in a big file: the whole text, not only the lines drawn', async () => {
  const f = fixture()
  const dir = join(f.root, 'logs')
  mkdirSync(dir)
  const lines = Array.from({ length: 50_000 }, (_, i) => `2026-11-01 10:00:00 INFO request ${i} done`)
  lines[45_000] = '2026-11-01 10:00:00 ERROR the needle broke'
  writeFileSync(join(dir, 'big.log'), lines.join('\n') + '\n')
  const { app, win } = await launch(f, join(dir, 'big.log'))
  try {
    const view = pane(win).getByTestId('code-view')
    await expect(view.locator('pre')).toHaveAttribute('data-virtual', '')
    await win.keyboard.press(`${mod}+f`)
    await win.getByTestId('find-input').fill('needle')
    await expect(win.getByTestId('find-count')).toHaveText(/^1 (of|из) 1$/)
    const row = view.locator('.code-line[data-n="45001"]')
    await expect(row).toBeInViewport()
    expect(await marks(win)).toEqual([1, 1])
    // Many matches: counted over the whole file, the place found when stepping.
    await win.getByTestId('find-input').fill('request 4999')
    await expect(win.getByTestId('find-count')).toHaveText(/^1 (of|из) 11$/)
    await win.getByTestId('find-input').press('Shift+Enter')
    await expect(view.locator('.code-line[data-n="49999"]')).toBeInViewport()
  } finally {
    await app.close()
  }
})
