import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const win32 = process.platform === 'win32'

/** The rows of the console in view, as text. */
const rows = (win: Page) => win.locator('[data-testid="console"]:not([hidden]) .dsk-term-row').allTextContents()
const hasRow = async (win: Page, wanted: (row: string) => boolean) => (await rows(win)).some((r) => wanted(r.trim()))

test('a console: the shell in Shared, a command and its output; another in a folder; the theme followed', async () => {
  const f = fixture()
  const dir = join(f.root, 'work folder')
  mkdirSync(dir, { recursive: true })
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()

    // Ctrl+`: a console opens, its shell answers.
    await win.keyboard.press('Control+Backquote')
    const panel = win.getByTestId('console-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('console-tab')).toHaveCount(1)
    await expect(win.locator('[data-testid="console"] .dsk-term-input')).toBeFocused()
    // A prompt is there before typing (the shell started).
    await expect.poll(async () => (await rows(win)).join('').trim().length, { timeout: 20_000 }).toBeGreaterThan(0)
    await win.keyboard.type(win32 ? '6*7' : 'echo $((6*7))')
    await win.keyboard.press('Enter')
    await expect.poll(() => hasRow(win, (r) => r === '42'), { timeout: 20_000 }).toBe(true)

    // A console in a folder: its working folder is that one.
    await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:console', path), dir)
    await expect(panel.getByTestId('console-tab')).toHaveCount(2)
    await expect(panel.getByTestId('console-tab').nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByTestId('console-tab').nth(1)).toContainText('work folder')
    await expect.poll(async () => (await rows(win)).join('').trim().length, { timeout: 20_000 }).toBeGreaterThan(0)
    await win.keyboard.type(win32 ? '(Get-Location).Path' : 'pwd')
    await win.keyboard.press('Enter')
    await expect.poll(() => hasRow(win, (r) => r.endsWith('work folder')), { timeout: 20_000 }).toBe(true)

    // The theme: the console's background follows the window's.
    const bg = () => win.locator('[data-testid="console"]:not([hidden]) .dsk-term').evaluate((el) => getComputedStyle(el).backgroundColor)
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('theme-dark').click()
    await expect.poll(bg).toBe('rgb(13, 17, 23)')
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('theme-light').click()
    await expect.poll(bg).toBe('rgb(255, 255, 255)')

    // Ended: the shell's exit is shown; the tab closes with its ×; Ctrl+` hides and shows the panel.
    await win.locator('[data-testid="console"]:not([hidden]) .dsk-term').click()
    await win.keyboard.type('exit')
    await win.keyboard.press('Enter')
    await expect(panel.getByTestId('console-tab').nth(1)).toHaveClass(/ended/, { timeout: 20_000 })
    await panel.getByTestId('console-tab').nth(1).locator('.console-tab-close').click()
    await expect(panel.getByTestId('console-tab')).toHaveCount(1)
    await win.keyboard.press('Control+Backquote')
    await expect(panel).toBeHidden()
    await win.getByTestId('toggle-console').click()
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('console-tab')).toHaveCount(1)
  } finally {
    await app.close()
  }
})
