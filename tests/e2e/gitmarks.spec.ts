import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('changes against the last commit in the gutter: marked as typed, shown and taken back, gone once committed', async () => {
  const f = fixture()
  const proj = join(f.root, 'svc')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'go.mod'), 'module svc\n')
  writeFileSync(join(proj, 'main.go'), 'package main\n\nfunc main() {\n\tprintln("hi")\n}\n')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: proj, encoding: 'utf8' })
  git('init', '-q')
  git('add', '.')
  git('commit', '-qm', 'start')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'svc' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'main.go' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await viewMode(win, 'visual')
    const editor = doc.locator('.dsk-code-editor')
    await expect(editor.locator('.dsk-code-editor__mark')).toHaveCount(0)

    // The greeting changed, a line added after it.
    await editor.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+Home`)
    for (let i = 0; i < 3; i++) await win.keyboard.press('ArrowDown')
    await win.keyboard.press('End')
    await win.keyboard.press('Backspace')
    await win.keyboard.press('Backspace')
    await win.keyboard.press('Backspace')
    await win.keyboard.press('Backspace')
    await win.keyboard.type('"hello")')
    await win.keyboard.press('End')
    await win.keyboard.press('Enter')
    await win.keyboard.type('println("bye")')
    await expect(editor.locator('.dsk-code-editor__mark--modified')).toHaveCount(2)

    // A click on the mark: what it was, and back.
    await editor.locator('.dsk-code-editor__mark--modified').first().click({ force: true })
    const peek = win.getByTestId('git-peek')
    await expect(peek).toContainText('println("hi")')
    await peek.getByTestId('git-revert').click()
    await expect(editor.locator('.dsk-code-editor__mark')).toHaveCount(0)
    expect(await doc.locator('.source-editor').evaluate((el) => (el as HTMLElement & { folioEditor: { value: string } }).folioEditor.value)).toBe(
      'package main\n\nfunc main() {\n\tprintln("hi")\n}\n',
    )

    // A line added and committed: the mark goes.
    await win.keyboard.press(`${mod}+End`)
    await win.keyboard.type('// end')
    await expect(editor.locator('.dsk-code-editor__mark--added')).toHaveCount(1)
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /main\.go/ })).not.toHaveClass(/dirty/)
    await win.keyboard.press('Control+Shift+G')
    const panel = win.getByTestId('changes-panel')
    await panel.getByTestId('changes-unstaged-all').click()
    await panel.getByTestId('changes-message').fill('A comment')
    await panel.getByTestId('changes-commit').click()
    await expect(editor.locator('.dsk-code-editor__mark')).toHaveCount(0)

    // Who changed each line, by a command: a column by the numbers; again, taken away.
    await win.keyboard.press(`${mod}+k`)
    await win.getByTestId('command-input').fill('blame')
    await win.getByTestId('command-input').press('Enter')
    const notes = editor.locator('.dsk-code-editor__annotation')
    await expect(notes.first()).toContainText('T ·')
    await expect(notes).toHaveCount(6)
    await editor.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+k`)
    await win.getByTestId('command-input').fill('blame')
    await win.getByTestId('command-input').press('Enter')
    await expect(notes).toHaveCount(0)
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
