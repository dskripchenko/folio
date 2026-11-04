import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('a CSV as a table: its separator guessed, the header kept, sorted by a column, a thousand rows at a time; its source edited', async () => {
  const f = fixture()
  const csv = join(f.folder, 'prices.csv')
  const rows = Array.from({ length: 2500 }, (_, i) => `Item ${i + 1};${(2500 - i) * 10};"note; with ""quotes"""`)
  writeFileSync(csv, ['name;price;note', ...rows].join('\n') + '\n')
  const app = await electron.launch({ args: ['.', csv], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    const table = pane.getByTestId('csv-view')
    await expect(table.locator('thead th')).toHaveText(['', 'name', 'price', 'note'])
    await expect(table.locator('tbody tr')).toHaveCount(1000)
    await expect(table.locator('tbody tr').first().locator('td')).toHaveText(['1', 'Item 1', '25000', 'note; with "quotes"'])
    await expect(win.getByTestId('status')).toHaveText(/2[\s,.\u00a0]?500 .*3/)
    // Sorted by price, up: numbers by value (10 first, not 100).
    await table.locator('thead th', { hasText: 'price' }).click()
    await expect(table.locator('tbody tr').first().locator('td').nth(2)).toHaveText('10')
    await expect(table.locator('tbody tr').nth(1).locator('td').nth(2)).toHaveText('20')
    await table.locator('thead th', { hasText: 'price' }).click()
    await expect(table.locator('tbody tr').first().locator('td').nth(2)).toHaveText('25000')
    // Scrolled down, the header stays in view.
    const view = win.locator('.view').first()
    await view.evaluate((el) => (el.scrollTop = 3000))
    await expect.poll(async () => {
      const [h, v] = await Promise.all([table.locator('thead th').nth(1).boundingBox(), view.boundingBox()])
      return Math.abs(h!.y - v!.y)
    }).toBeLessThan(40)
    // A thousand more.
    await table.getByTestId('csv-more').click()
    await expect(table.locator('tbody tr')).toHaveCount(2000)
    // The source in the code editor; saved as written.
    await viewMode(win, 'visual')
    const editor = pane.locator('.source-editor')
    await expect(editor).toBeVisible()
    await editor.evaluate((el) => {
      const e = (el as HTMLElement & { folioEditor: { value: string; dispatch(s: object): void } }).folioEditor
      e.dispatch({ changes: { from: 0, to: 4, insert: 'title' } })
    })
    await win.keyboard.press(`${mod}+s`)
    await expect.poll(() => readFileSync(csv, 'utf8').split('\n')[0]).toBe('title;price;note')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('two files compared: the changes, side by side, the other one’s text taken on asking', async () => {
  const f = fixture()
  const dir = join(f.folder, 'cmp')
  mkdirSync(dir)
  const a = join(dir, 'old.md')
  const b = join(dir, 'new.md')
  writeFileSync(a, '# Notes\n\nkept\nremoved line\n')
  writeFileSync(b, '# Notes\n\nkept\nadded line\n')
  const app = await electron.launch({ args: ['.', b], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Notes' })).toBeVisible()
    await app.evaluate(({ BrowserWindow }, paths) => BrowserWindow.getAllWindows()[0]!.webContents.send('compare:files', { a: paths[0], b: paths[1] }), [a, b])
    await expect(pane.getByTestId('version-bar')).toContainText(/old\.md/)
    const diff = pane.getByTestId('diff')
    await expect(diff.locator('.del')).toHaveText(['removed line'])
    await expect(diff.locator('.add')).toHaveText(['added line'])
    await pane.getByTestId('version-bar').locator('[data-mode="side"]').click()
    await expect(pane.locator('.side-by-side h4')).toHaveText(['old.md', 'new.md'])
    // Its text taken: an edit of this file, not yet saved.
    await pane.getByTestId('version-bar').locator('.restore').click()
    await expect(win.getByRole('tab', { name: /new\.md/ })).toHaveClass(/dirty/)
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('the file in view compared with one chosen like going to a file', async () => {
  const f = fixture()
  const a = join(f.folder, 'draft.md')
  const b = join(f.folder, 'final.md')
  writeFileSync(a, '# Doc\n\nfirst draft\n')
  writeFileSync(b, '# Doc\n\nfinal text\n')
  const app = await electron.launch({ args: ['.', b], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Doc' })).toBeVisible()
    // Its folder a project: the picker lists the projects' files.
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [f.folder])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    await expect(win.getByTestId('projects').locator('.project', { hasText: 'notes' })).toBeVisible()
    await win.getByRole('tab', { name: /final\.md/ }).click()
    await win.keyboard.press(`${mod}+k`)
    const russian = (await win.evaluate(() => document.documentElement.lang)).startsWith('ru')
    await win.getByTestId('command-input').fill(russian ? 'сравнить' : 'compare')
    await win.getByTestId('command-palette').locator('[data-command="compare-with"]').click()
    await win.getByTestId('go-to-file-input').fill('draft')
    await win.keyboard.press('Enter')
    await expect(pane.getByTestId('version-bar')).toContainText(/draft\.md/)
    await expect(pane.getByTestId('diff').locator('.add')).toHaveText(['final text'])
    // The picker opens files again afterwards.
    await win.keyboard.press(`${mod}+t`)
    await win.getByTestId('go-to-file-input').fill('draft')
    await win.keyboard.press('Enter')
    await expect(win.getByRole('tab', { name: /draft\.md/ })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
