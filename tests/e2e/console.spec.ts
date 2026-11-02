import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const win32 = process.platform === 'win32'
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/** The console in front (of the tab in front). */
const front = (win: Page) => win.locator('.console-group:not([hidden]) .console-pane.active, .console-group:not([hidden]) .console-pane:only-child').first()
/** Its rows, as text. */
const rows = (win: Page) => front(win).locator('.dsk-term-row').allTextContents()
const hasRow = async (win: Page, wanted: (row: string) => boolean) => (await rows(win)).some((r) => wanted(r.trim()))
const prompt = async (win: Page) => expect.poll(async () => (await rows(win)).join('').trim().length, { timeout: 20_000 }).toBeGreaterThan(0)
/** Typed and run; waits for the command's mark (shell integration) when there is one. */
async function run(win: Page, line: string): Promise<void> {
  const marks = await front(win).locator('.dsk-term-mark').count()
  await win.keyboard.type(line)
  await win.keyboard.press('Enter')
  await expect.poll(() => front(win).locator('.dsk-term-mark').count(), { timeout: 20_000 }).toBeGreaterThan(marks)
}

test('a console: the shell, its commands marked, a path opened at its line; another beside it; the panel moved and maximized', async () => {
  const f = fixture()
  const dir = join(f.root, 'work folder')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'main.ts'), Array.from({ length: 80 }, (_, i) => `const line${i + 1} = ${i + 1}`).join('\n') + '\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()

    // Ctrl+`: a console opens; with the shell's integration, each command gets a mark by how it ended.
    await win.keyboard.press('Control+Backquote')
    const panel = win.getByTestId('console-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('console-tab')).toHaveCount(1)
    await prompt(win)
    await run(win, win32 ? '6*7' : 'echo $((6*7))')
    await expect.poll(() => hasRow(win, (r) => r === '42')).toBe(true)
    await expect(front(win).locator('.dsk-term-mark').last()).toHaveClass(/ok/)
    await run(win, win32 ? 'cmd /c exit 3' : 'false')
    await expect(front(win).locator('.dsk-term-mark').last()).toHaveClass(/fail/)
    await expect(panel.getByTestId('console-tab')).toHaveAttribute('data-state', 'fail')

    // A console in a folder: the tab says the folder; a path in the output opens the file at its line.
    await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:console', path), dir)
    await expect(panel.getByTestId('console-tab')).toHaveCount(2)
    await expect(panel.getByTestId('console-tab').nth(1)).toContainText('work folder')
    await prompt(win)
    await run(win, win32 ? 'Write-Output "error at src/main.ts:60:5"' : 'echo "error at src/main.ts:60:5"')
    const link = front(win).locator('.dsk-term-link', { hasText: 'src/main.ts:60:5' }).last()
    await win.keyboard.down(mod)
    await link.click()
    await win.keyboard.up(mod)
    await expect(win.getByRole('tab', { name: /main\.ts/ })).toHaveAttribute('aria-selected', 'true')
    await expect(win.locator('article.doc:not([hidden]) .code-line[data-n="60"]')).toBeInViewport()

    // Find in the output: the find bar over the console's text.
    await front(win).locator('.dsk-term').click()
    await win.keyboard.press(`${mod}+f`)
    await win.getByTestId('find-input').fill('error at')
    await expect(win.getByTestId('find-count')).toHaveText(/(of|из) [12]$/)
    await expect(front(win).locator('.dsk-term-match.current')).toHaveCount(1)
    await win.getByTestId('find-input').press('Escape')

    // A file dragged from the tree is typed as its path.
    const dt = await win.evaluateHandle((p) => {
      const d = new DataTransfer()
      d.setData('application/x-folio-path', p)
      return d
    }, join(dir, 'src', 'main.ts'))
    await front(win).dispatchEvent('drop', { dataTransfer: dt })
    await expect.poll(() => hasRow(win, (r) => r.includes('main.ts'))).toBe(true)
    await win.keyboard.press('Control+c')

    // Split: two consoles side by side in one tab.
    await panel.getByTestId('console-split').click()
    await expect(win.locator('.console-group:not([hidden]) .console-pane')).toHaveCount(2)
    await expect(panel.getByTestId('console-split')).toBeDisabled()
    // The new one has the keyboard.
    await prompt(win)
    await run(win, win32 ? 'Write-Output beside' : 'echo beside')
    await expect.poll(() => hasRow(win, (r) => r === 'beside')).toBe(true)

    // Beside the page, then the whole window, then back.
    await panel.getByTestId('console-position').click()
    await expect(panel).toHaveClass(/right/)
    expect(await panel.evaluate((el) => el.parentElement!.className)).toContain('content')
    await panel.getByTestId('console-maximize').click()
    await expect(win.getByTestId('view')).toBeHidden()
    await panel.getByTestId('console-maximize').click()
    await expect(win.getByTestId('view')).toBeVisible()
    await panel.getByTestId('console-position').click()
    await expect(panel).not.toHaveClass(/right/)

    // The context menu: clear keeps the prompt.
    await front(win).locator('.dsk-term').click({ button: 'right' })
    await win.locator('.pop-menu button', { hasText: /^(Clear|Очистить)/ }).click()
    await expect.poll(async () => (await rows(win)).filter((r) => r.trim() !== '').length).toBeLessThanOrEqual(2)

    // The theme: the console's background follows the window's.
    const bg = () => front(win).locator('.dsk-term').evaluate((el) => getComputedStyle(el).backgroundColor)
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('theme-dark').click()
    await expect.poll(bg).toBe('rgb(22, 27, 34)')
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('theme-light').click()
    await expect.poll(bg).toBe('rgb(250, 250, 250)')

    // A shell that ends: the tab says so; Ctrl+` hides and shows the panel.
    await front(win).locator('.dsk-term').click()
    await win.keyboard.type('exit')
    await win.keyboard.press('Enter')
    await expect.poll(() => front(win).locator('.dsk-term-row', { hasText: /(shell ended|оболочка завершилась)/ }).count(), { timeout: 20_000 }).toBeGreaterThan(0)
    await win.keyboard.press('Control+Backquote')
    await expect(panel).toBeHidden()
    await win.getByTestId('toggle-console').click()
    await expect(panel).toBeVisible()
  } finally {
    await app.close()
  }
})
