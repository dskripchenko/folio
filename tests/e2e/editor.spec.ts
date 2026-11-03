import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mac = process.platform === 'darwin'
const mod = mac ? 'Meta' : 'Control'

test('a source file in the code editor: highlighted, indented by .editorconfig, found in, gone to a line, saved', async () => {
  const f = fixture()
  const proj = join(f.root, 'web')
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, '.editorconfig'), 'root = true\n[*.ts]\nindent_style = space\nindent_size = 3\n')
  const lines = ['export function total(items: number[]) {', '  let sum = 0', '  for (const x of items) sum += x', '  return sum', '}', '']
  writeFileSync(join(proj, 'src', 'total.ts'), lines.join('\n'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'web' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'src' }).click()
    await project.locator('.tree .row', { hasText: 'total.ts' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await viewMode(win, 'visual')
    const editor = doc.locator('.dsk-code-editor')
    await expect(editor.locator('.sx-keyword').first()).toHaveText('export')

    // The status line: the caret, the indentation from .editorconfig, the line breaks, the language.
    await editor.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+Home`)
    const status = win.getByTestId('status')
    await expect(status).toHaveText(/^(Ln|Стр) 1, (Col|кол) 1 · (Spaces|Пробелы): 3 · LF · TypeScript( · .+)?$/)

    // Enter after a brace: a step of three spaces deeper.
    await win.keyboard.press('End')
    await win.keyboard.press('Enter')
    await win.keyboard.type('// sum')
    await expect(status).toHaveText(/^(Ln|Стр) 2, (Col|кол) 10/)

    // Find: the bar marks the matches in the editor, Enter goes to the next one.
    await win.keyboard.press(`${mod}+f`)
    await win.getByTestId('find-input').fill('sum')
    await expect(win.getByTestId('find-count')).toHaveText(/1 (of|из) 4/)
    await expect(editor.locator('.dsk-code-editor__match')).toHaveCount(4)
    await win.getByTestId('find-input').press('Enter')
    await expect(win.getByTestId('find-count')).toHaveText(/2 (of|из) 4/)
    await win.getByTestId('find-input').press('Escape')
    await expect(editor.locator('.dsk-code-editor__match')).toHaveCount(0)

    // Ctrl+G on every system: go to a line.
    await win.keyboard.press('Control+g')
    const field = editor.locator('.dsk-code-editor__panel-input')
    await expect(field).toBeFocused()
    await field.fill('5')
    await field.press('Enter')
    await expect(status).toHaveText(/^(Ln|Стр) 5, (Col|кол) 1/)

    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /total\.ts/ })).not.toHaveClass(/dirty/)
    expect(readFileSync(join(proj, 'src', 'total.ts'), 'utf8')).toBe(['export function total(items: number[]) {', '   // sum', ...lines.slice(1)].join('\n'))
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('a big file is edited too: 20 MB, saved whole', async () => {
  test.setTimeout(120_000)
  const f = fixture()
  const file = join(f.folder, 'big.log')
  const body = Array.from({ length: 400_000 }, (_, i) => `2026-11-01T10:00:00Z INFO line ${i} ${'x'.repeat(20)}`).join('\n')
  writeFileSync(file, body)
  const app = await electron.launch({ args: ['.', file], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const doc = win.locator('article.doc:not([hidden])')
    await expect(doc.getByTestId('code-view')).toBeVisible({ timeout: 30_000 })
    await viewMode(win, 'visual')
    const editor = doc.locator('.dsk-code-editor')
    await editor.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+End`)
    await win.keyboard.type(' END')
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /big\.log/ })).not.toHaveClass(/dirty/, { timeout: 30_000 })
    expect(readFileSync(file, 'utf8')).toBe(body + ' END')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
