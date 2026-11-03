import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('a project’s own settings (.folio/settings.json) and keys of one’s own (keybindings.json)', async () => {
  const f = fixture()
  const proj = join(f.root, 'tool')
  mkdirSync(join(proj, '.folio'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "tool" }\n')
  writeFileSync(join(proj, '.editorconfig'), 'root = true\n[*]\nindent_style = space\nindent_size = 2\n')
  writeFileSync(join(proj, 'main.ts'), 'one\ntwo\n')
  writeFileSync(join(proj, '.hidden.ts'), 'x\n')
  // Taken for notes, though it has a package.json; tabs over .editorconfig's spaces.
  writeFileSync(join(proj, '.folio', 'settings.json'), JSON.stringify({ kind: 'notes', indentUnit: '\t', tabSize: 4 }))
  mkdirSync(f.data, { recursive: true })
  writeFileSync(
    join(f.data, 'keybindings.json'),
    JSON.stringify([
      { key: 'Mod-Shift-d', command: 'copyLineDown' },
      { key: 'Mod-Alt-p', command: 'folio.problems' },
      { key: 'Mod-Alt-q', command: 'nonsense' },
    ]),
  )
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'tool' })
    await project.locator('.project-row').click()
    const tree = project.locator('.tree')
    // A project of notes: its dot files hidden.
    await expect(tree.locator('.row', { hasText: 'main.ts' })).toBeVisible()
    await expect(tree.locator('.row', { hasText: '.hidden.ts' })).toHaveCount(0)
    await tree.locator('.row', { hasText: 'main.ts' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await viewMode(win, 'visual')
    await doc.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+Home`)
    await expect(win.getByTestId('status')).toHaveText(/(Tab|Табуляция): 4/)

    // An editor command by a key of one's own.
    await win.keyboard.press(`${mod}+Shift+D`)
    expect(await doc.locator('.source-editor').evaluate((el) => (el as HTMLElement & { folioEditor: { value: string } }).folioEditor.value)).toBe('one\none\ntwo\n')
    // A folio command by a key of one's own.
    await win.keyboard.press(`${mod}+Alt+P`)
    await expect(win.getByTestId('problems-panel')).toBeVisible()
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
