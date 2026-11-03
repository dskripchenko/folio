import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('formatting on save: the project’s formatter over the text, what changed changed, undone as one step', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(join(proj, '.folio'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'a.js'), 'const a = 1\n')
  // A formatter of its own: runs of spaces become one.
  writeFileSync(join(proj, 'fmt.js'), "let t = ''\nprocess.stdin.on('data', (d) => (t += d)).on('end', () => process.stdout.write(t.replace(/ {2,}/g, ' ')))\n")
  writeFileSync(join(proj, '.folio', 'settings.json'), JSON.stringify({ formatOnSave: true, formatter: 'node fmt.js' }))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'a.js' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await viewMode(win, 'visual')
    const value = () => doc.locator('.source-editor').evaluate((el) => (el as HTMLElement & { folioEditor: { value: string } }).folioEditor.value)
    await doc.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+End`)
    await win.keyboard.type('const   b   =   2')
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /a\.js/ })).not.toHaveClass(/dirty/)
    expect(readFileSync(join(proj, 'a.js'), 'utf8')).toBe('const a = 1\nconst b = 2')
    expect(await value()).toBe('const a = 1\nconst b = 2')
    // The formatting is one step to undo.
    await win.keyboard.press(`${mod}+z`)
    expect(await value()).toBe('const a = 1\nconst   b   =   2')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
