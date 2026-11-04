import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('the settings window: a key of one’s own set by pressing it, working at once, a clash shown, removed; the project’s settings as a form', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(join(proj, '.folio'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'main.js'), 'const a = 1\n')
  // A key folio does not know: kept as it is.
  writeFileSync(join(proj, '.folio', 'settings.json'), JSON.stringify({ custom: { keep: true }, tabSize: 8 }))
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
    await project.locator('.tree .row', { hasText: 'main.js' }).click()

    // Cmd/Ctrl+, : the keys; a key for "show or hide the sidebar", pressed.
    await win.keyboard.press(`${mod}+Comma`)
    const settings = win.getByTestId('settings')
    await expect(settings).toBeVisible()
    const sidebarRow = settings.locator('[data-testid="settings-command"][data-command="folio.sidebar"]')
    await settings.getByTestId('settings-search').fill(await sidebarRow.locator('.settings-name').evaluate((el) => el.firstChild?.textContent ?? ''))
    await sidebarRow.getByTestId('settings-set').click()
    await win.keyboard.press('Alt+Shift+KeyY')
    await expect(sidebarRow.getByTestId('settings-own-key')).toHaveCount(1)
    expect(JSON.parse(readFileSync(join(f.data, 'keybindings.json'), 'utf8'))).toEqual([{ key: 'Alt-Shift-y', command: 'folio.sidebar' }])

    // The same key on another command: the clash is said.
    await settings.getByTestId('settings-search').fill('')
    const paletteRow = settings.locator('[data-testid="settings-command"][data-command="folio.settings"]')
    await paletteRow.getByTestId('settings-set').click()
    await win.keyboard.press('Alt+Shift+KeyY')
    await expect(paletteRow.getByTestId('settings-clash')).toBeVisible()
    await paletteRow.getByTestId('settings-unbind').click()
    await expect(paletteRow.getByTestId('settings-own-key')).toHaveCount(0)

    // At work at once: the window closed, the key hides the sidebar.
    await win.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    const sidebar = win.locator('.sidebar')
    const before = await sidebar.evaluate((el) => el.getBoundingClientRect().width)
    await win.keyboard.press('Alt+Shift+KeyY')
    await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).not.toBe(before)

    // The project's settings: indentation, formatting, a task, a language server off; other keys kept.
    await win.keyboard.press(`${mod}+Comma`)
    await settings.getByTestId('settings-project').click()
    const form = settings.getByTestId('settings-project-form')
    await expect(form.getByTestId('settings-tabSize')).toHaveValue('8')
    await form.getByTestId('settings-indent').selectOption('2')
    await form.getByTestId('settings-tabSize').fill('2')
    await form.getByTestId('settings-formatOnSave').check()
    await form.getByTestId('settings-formatter').selectOption('own')
    await form.getByTestId('settings-formatterCommand').fill('node fmt.js')
    await form.getByTestId('settings-tasks-add').click()
    const task = form.getByTestId('settings-tasks').locator('.settings-list-row input')
    await task.nth(0).fill('serve')
    await task.nth(1).fill('node server.js')
    await form.getByTestId('settings-servers-add').click()
    const server = form.getByTestId('settings-servers').locator('.settings-list-row input')
    await server.nth(0).fill('python')
    await server.nth(1).fill('off')
    await form.getByTestId('settings-save').click()
    await expect(form.getByTestId('settings-said')).not.toBeEmpty()
    expect(JSON.parse(readFileSync(join(proj, '.folio', 'settings.json'), 'utf8'))).toEqual({
      custom: { keep: true },
      tabSize: 2,
      indentUnit: '  ',
      formatOnSave: true,
      formatter: 'node fmt.js',
      tasks: [{ name: 'serve', command: 'node server.js' }],
      lsp: { python: false },
    })
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
