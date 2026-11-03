import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('a task of the project: run in a console, its problems in a panel and marked in the editor', async () => {
  const f = fixture()
  const proj = join(f.root, 'web')
  mkdirSync(join(proj, 'src'), { recursive: true })
  mkdirSync(join(proj, '.folio'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'web', scripts: { build: 'echo built' } }))
  writeFileSync(join(proj, 'src', 'a.ts'), 'export const a = 1\nexport const b: number = "x"\n')
  // A checker of its own: tsc's form, then a failure.
  writeFileSync(join(proj, 'check.js'), "console.log('src/a.ts(2,14): error TS2322: Type \\'string\\' is not assignable to type \\'number\\'.'); process.exit(2)\n")
  writeFileSync(join(proj, '.folio', 'settings.json'), JSON.stringify({ tasks: [{ name: 'check', command: 'node check.js' }] }))
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
    await project.locator('.tree .row', { hasText: 'a.ts' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await viewMode(win, 'visual')
    const editor = doc.locator('.dsk-code-editor')
    await editor.locator('.dsk-code-editor__content').click()

    // Cmd/Ctrl+Shift+B: the project's tasks — its scripts and its own.
    await win.keyboard.press(`${mod}+Shift+B`)
    const items = win.getByTestId('go-to-symbol-item')
    await expect(items).toHaveCount(2)
    await win.getByTestId('go-to-symbol-input').fill('check')
    await win.getByTestId('go-to-symbol-input').press('Enter')

    // Run in a console tab of its own; its problems in the panel and in the editor.
    await expect(win.getByTestId('console-tab').filter({ hasText: 'check' })).toBeVisible()
    const panel = win.getByTestId('problems-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByTestId('problem')).toHaveCount(1)
    await expect(panel.getByTestId('problem')).toContainText("Type 'string' is not assignable")
    await expect(editor.locator('.dsk-code-editor__diagnostic--error')).toHaveCount(1)

    // A click: to the place.
    await editor.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+Home`)
    await panel.getByTestId('problem').click()
    await expect(win.getByTestId('status')).toHaveText(/^(Ln|Стр) 2, (Col|кол) 14/)

    // The last task run comes first next time.
    await win.keyboard.press(`${mod}+Shift+B`)
    await expect(items.first()).toContainText('check')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
