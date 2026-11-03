import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const server = join(import.meta.dirname, '..', 'fixtures', 'fake-lsp.mjs')

type Editor = HTMLElement & { folioEditor: { value: string; setSelection(a: number, h?: number): void; focus(): void; diagnostics: readonly { message: string }[] } }

test('a language server of the project: trusted once; problems, hover, definition, completion, rename, actions, formatting, symbols', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(join(proj, '.folio'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'lib.js'), 'export function greet(name) {\n  return name\n}\n')
  writeFileSync(join(proj, 'a.js'), "import { greet } from './lib.js'\nconst bad = greet('x')\n")
  writeFileSync(join(proj, '.folio', 'settings.json'), JSON.stringify({ lsp: { javascript: [process.execPath, server] }, formatOnSave: true, formatter: 'lsp' }))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      const g = globalThis as { asked?: number }
      g.asked = 0
      dialog.showMessageBox = (async () => ((g.asked = (g.asked ?? 0) + 1), { response: 0, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'a.js' }).click()
    await viewMode(win, 'visual')
    const doc = win.locator('article.doc:not([hidden])')
    const editor = doc.locator('.source-editor')
    const value = () => editor.evaluate((el) => (el as Editor).folioEditor.value)
    const cursorAt = async (text: string, delta = 1) => {
      await editor.evaluate((el, [t, d]) => {
        const e = (el as Editor).folioEditor
        e.focus()
        e.setSelection(e.value.indexOf(t as string) + (d as number))
      }, [text, delta] as const)
    }

    // Trusted once (the server is the project's own command), its problems in the editor and the panel.
    await expect.poll(() => editor.evaluate((el) => (el as Editor).folioEditor.diagnostics.map((d) => d.message).join())).toContain('bad is not allowed')
    expect(await app.evaluate(() => (globalThis as { asked?: number }).asked)).toBe(1)
    await expect(win.getByTestId('status')).toContainText('node')

    // Hover over a name: what the server says of it.
    // (The pointer rests on the word; again if the lines moved under it while the page settled.)
    const word = doc.locator('.dsk-code-editor__line', { hasText: 'const bad' }).locator('span', { hasText: /^greet$/ }).first()
    await expect(async () => {
      await win.mouse.move(0, 0)
      await word.hover()
      const box = (await word.boundingBox())!
      await win.mouse.move(box.x + 6, box.y + box.height / 2, { steps: 2 })
      await expect(doc.locator('.dsk-code-editor__tooltip:not([hidden])')).toContainText('a fake type', { timeout: 2000 })
    }).toPass({ timeout: 15_000 })

    // Completion: the server's item, its snippet's place selected.
    await cursorAt("'x')", 4)
    await win.keyboard.press('Enter')
    await win.keyboard.type('fr')
    await win.keyboard.press('Control+Space')
    await expect(doc.locator('.dsk-code-editor__completion-item', { hasText: 'fromServer' })).toBeVisible()
    await doc.locator('.dsk-code-editor__completion-item', { hasText: 'fromServer' }).click()
    await expect.poll(value).toContain('fromServer(arg)')
    await win.keyboard.type('1')
    await expect.poll(value).toContain('fromServer(1)')

    // An action on a problem: Cmd/Ctrl+. and Enter.
    await cursorAt('bad')
    await win.keyboard.press(`${mod}+.`)
    await expect(doc.locator('.dsk-code-editor__menu')).toContainText('Replace bad with good')
    await win.keyboard.press('Enter')
    await expect.poll(value).toContain('const good =')
    await expect.poll(() => editor.evaluate((el) => (el as Editor).folioEditor.diagnostics.length)).toBe(0)

    // Rename across the project: this tab and the closed file on disk.
    await cursorAt('greet(')
    await win.keyboard.press('F2')
    await expect(doc.locator('.dsk-code-editor__prompt')).toBeVisible()
    await win.keyboard.press(`${mod}+a`)
    await win.keyboard.type('hello')
    await win.keyboard.press('Enter')
    await expect.poll(value).toContain("import { hello } from './lib.js'\nconst good = hello('x')")
    await expect.poll(() => readFileSync(join(proj, 'lib.js'), 'utf8')).toContain('export function hello(name)')

    // Formatting by the server on save.
    await cursorAt('fromServer(1)', 13)
    await win.keyboard.type('  ;   ')
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /a\.js/ })).not.toHaveClass(/dirty/)
    expect(readFileSync(join(proj, 'a.js'), 'utf8')).toContain('fromServer(1) ; ')

    // F12: the definition, in another file.
    await cursorAt('hello(', 2)
    await win.keyboard.press('F12')
    await expect(win.getByRole('tab', { name: /lib\.js/ })).toHaveAttribute('aria-selected', 'true')
    // Its symbols from the server in the outline.
    await win.getByTestId('toggle-outline').click()
    await expect(win.getByTestId('outline-panel')).toContainText('hello (server)')

    // The server's output.
    await win.keyboard.press(`${mod}+k`)
    const russian = (await win.evaluate(() => document.documentElement.lang)).startsWith('ru')
    await win.getByTestId('command-input').fill(russian ? 'вывод сервера' : 'server output')
    await win.getByTestId('command-palette').locator('[data-command="lsp-log"]').click()
    await expect(win.locator('article.doc:not([hidden])')).toContainText('fake-lsp: ready')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
