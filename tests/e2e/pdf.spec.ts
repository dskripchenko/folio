import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const samples = join(import.meta.dirname, '..', 'fixtures', 'diagrams')

/** poppler's tools when installed (CI installs them on Linux and macOS); the checks that need them are skipped otherwise. */
const poppler = (() => {
  try {
    execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
if (process.env.FOLIO_REQUIRE_POPPLER && !poppler) throw new Error('poppler (pdftotext, pdfinfo) is required here')
const pdftext = (file: string) => execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
const pages = (file: string) => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))![1])
const pageSize = (file: string) => /Page size:\s+([\d.]+) x ([\d.]+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))!.slice(1).map(Number)

async function saveAs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
  }, file)
}

async function exportWith(win: Page, settings: { size?: string; orientation?: string; toc?: boolean }): Promise<void> {
  const d = win.getByTestId('pdf-dialog')
  await expect(d).toBeVisible()
  if (settings.size) await d.getByTestId('pdf-size').selectOption(settings.size)
  if (settings.orientation) await d.getByTestId('pdf-orientation').selectOption(settings.orientation)
  if (settings.toc !== undefined) await d.getByTestId('pdf-toc').setChecked(settings.toc)
  await d.getByRole('button', { name: /^(Export…|Экспортировать…)$/ }).click()
  await expect(d).toHaveCount(0, { timeout: 60_000 })
}

test('a document and a folder exported as PDF: page size, header and footer, contents, bookmarks, links within', async () => {
  const f = fixture()
  const book = join(f.root, 'handbook')
  mkdirSync(join(book, 'guides'), { recursive: true })
  writeFileSync(join(book, 'README.md'), '# Handbook\n\nStart with the [setup guide](guides/setup.md).\n\n## Purpose\n\nWhy it exists.\n\n```mermaid\nflowchart LR\n  Read --> Do\n```\n')
  writeFileSync(join(book, 'guides', 'setup.md'), '# Setup guide\n\n## Install\n\nInstall it.\n\n## Configure\n\nConfigure it.\n')
  copyFileSync(join(samples, 'loan.dmn'), join(book, 'guides', 'loan.dmn'))
  const out = join(f.root, 'out')
  mkdirSync(out)
  const app = await electron.launch({ args: ['.', join(book, 'README.md')], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('article.doc:not([hidden]) dsk-markdown h1')).toHaveText('Handbook')

    // One document, with an edit not saved yet: exported as shown.
    if ((await win.locator('article.doc:not([hidden]) dsk-markdown-editor').count()) === 0) await win.getByTestId('mode-visual').click()
    const h1 = win.locator('article.doc:not([hidden]) dsk-markdown-editor [contenteditable="true"] h1').first()
    await h1.click()
    await win.keyboard.press('End')
    await win.keyboard.type(' (draft)')
    const one = join(out, 'readme.pdf')
    await saveAs(app, one)
    await win.keyboard.press(`${mod}+Shift+p`)
    await exportWith(win, { size: 'A5', orientation: 'landscape', toc: true })
    await expect(win.getByTestId('notice')).toContainText('readme.pdf')
    expect(readFileSync(one).subarray(0, 5).toString()).toBe('%PDF-')
    const raw = readFileSync(one).toString('latin1')
    expect(raw).toMatch(/\/Outlines/)
    if (poppler) {
      // A5 landscape: 595 × 420 pt.
      const [w, h] = pageSize(one)
      // Chromium rounds paper sizes to the point.
      expect(Math.abs(w! - 595)).toBeLessThan(2)
      expect(Math.abs(h! - 420)).toBeLessThan(2)
      const text = pdftext(one)
      expect(text).toMatch(/Contents|Содержание/)
      expect(text).toContain('Handbook (draft)')
      expect(text).toMatch(/1\s*\/\s*\d+/)
      // The diagram printed, not its source.
      expect(text).not.toContain('flowchart LR')
      expect(text).toContain('Read')
    }

    // The folder as one PDF, from the project's menu… here through the same message the menu sends.
    const book2 = join(out, 'handbook.pdf')
    await saveAs(app, book2)
    await app.evaluate(({ BrowserWindow }, dir) => BrowserWindow.getAllWindows().find((w) => w.isVisible())!.webContents.send('menu:export-folder', dir), book)
    await exportWith(win, { size: 'A4', orientation: 'portrait', toc: true })
    expect(existsSync(book2)).toBe(true)
    if (poppler) {
      const [w, h] = pageSize(book2)
      expect(Math.abs(w! - 595)).toBeLessThan(2)
      expect(Math.abs(h! - 842)).toBeLessThan(2)
      // Contents, the README, the setup guide, the DMN file: each from a new page.
      expect(pages(book2)).toBeGreaterThanOrEqual(4)
      const text = pdftext(book2)
      expect(text.indexOf('Handbook')).toBeLessThan(text.indexOf('Setup guide'))
      expect(text).toMatch(/Contents|Содержание/)
      for (const s of ['Setup guide', 'Install', 'Configure', 'loan.dmn', 'Risk category']) expect(text).toContain(s)
      // The DMN file in its print form: its decision tables, not the live viewer's zoom.
      expect(text).toContain('Poor history')
      expect(text).not.toMatch(/\d+\s*%/)
      // The saved README, not the draft of the open tab.
      expect(text).not.toContain('(draft)')
    }
    // The link to the other document points inside the PDF, not to folio's address.
    expect(readFileSync(book2).toString('latin1').match(/folio:\/\/app[^)>\s]*/g) ?? []).toEqual([])
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
