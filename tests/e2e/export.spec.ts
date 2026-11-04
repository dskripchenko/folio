import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const note = [
  '# Quarterly report',
  '',
  'Plain, **bold** and *italic*, `code()`, a [link](https://example.com).',
  '',
  '- First point',
  '- Second point',
  '',
  '| Name | Price |',
  '|------|-------|',
  '| Tea  | 1.50  |',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '![red](img/red.png)',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Cart] --> B[Paid]',
  '```',
  '',
].join('\n')

test('a note exported as one HTML page and as a Word file: its text, its picture, its diagram', async () => {
  const f = fixture()
  const doc = join(f.folder, 'report.md')
  writeFileSync(doc, note)
  const html = join(f.root, 'report.html')
  const docx = join(f.root, 'report.docx')
  const app = await electron.launch({ args: ['.', doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('article.doc:not([hidden]) h1', { hasText: 'Quarterly report' })).toBeVisible()
    const run = async (id: string, target: string) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
      }, target)
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
      await win.getByTestId('command-palette').locator(`[data-command="${id}"]`).click()
      await expect.poll(() => existsSync(target), { timeout: 30_000 }).toBe(true)
    }

    await run('export-html', html)
    const page = readFileSync(html, 'utf8')
    expect(page).toMatch(/^<!doctype html>/)
    expect(page).toContain('Quarterly report')
    expect(page).toContain('<strong>bold</strong>')
    // Nothing that only folio can load: the picture inside, the diagram drawn.
    expect(page).not.toContain('folio://')
    expect(page).toMatch(/src="data:image\/png;base64,/)
    expect(page).toMatch(/<svg[\s\S]*Cart[\s\S]*Paid/)
    expect(page).not.toContain('<script')

    await run('export-docx', docx)
    await expect.poll(() => readFileSync(docx).length).toBeGreaterThan(1000)
    expect(execFileSync('unzip', ['-t', docx], { encoding: 'utf8' })).toMatch(/No errors detected/)
    const parts = execFileSync('unzip', ['-Z1', docx], { encoding: 'utf8' }).split('\n').filter((p) => p.startsWith('word/media/'))
    // The picture, and the diagram as one.
    expect(parts.length).toBeGreaterThanOrEqual(2)
    const document = execFileSync('unzip', ['-p', docx, 'word/document.xml'], { encoding: 'utf8' })
    expect(document).toContain('Heading1')
    expect(document).toContain('<w:b/>')
    expect(document).toContain('<w:tbl>')
    expect(document).toContain('const a = 1')
    // A code block's header (its language, the copy button) is not the document.
    expect(document).not.toMatch(/<w:t xml:space="preserve">js<\/w:t>/)
    if (process.platform === 'darwin') {
      const text = execFileSync('textutil', ['-convert', 'txt', '-stdout', docx], { encoding: 'utf8' })
      for (const words of ['Quarterly report', 'First point', 'Second point', 'Tea', '1.50']) expect(text).toContain(words)
    }
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
