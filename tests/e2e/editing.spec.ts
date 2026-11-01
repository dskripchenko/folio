import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, type Fixture } from './fixture'

const launch = (f: Fixture, ...files: string[]) =>
  electron.launch({ args: ['.', ...files], env: { ...process.env, FOLIO_DATA: f.data } })

const pane = (win: Page) => win.locator('article.doc:not([hidden])')
const editor = (win: Page) => pane(win).locator('dsk-markdown-editor [contenteditable="true"]').first()
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Type at the end of the editor's first heading. */
async function typeInHeading(win: Page, text: string): Promise<void> {
  await pane(win).locator('dsk-markdown-editor [contenteditable="true"] h1').first().click()
  await win.keyboard.press('End')
  await win.keyboard.type(text)
}

/** The buffers on disk: wait for the one typed to be written. */
async function settle(win: Page): Promise<void> {
  await win.waitForTimeout(1200)
}

async function hardKill(app: ElectronApplication): Promise<void> {
  // As a crash or a power cut: no chance to say goodbye.
  app.process().kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 500))
}

test('an edit is kept, unsaved, through a crash; the file changes only on Save', async () => {
  const f = fixture()
  const file = join(f.folder, 'other.md')
  const original = readFileSync(file, 'utf8')
  let app = await launch(f, file)
  try {
    let win = await app.firstWindow()
    await win.getByTestId('toggle-edit').click()
    await expect(editor(win)).toBeVisible({ timeout: 20_000 })
    await typeInHeading(win, ' — draft')
    await expect(win.getByRole('tab', { name: /other\.md/ })).toHaveClass(/dirty/)
    await settle(win)
    await hardKill(app)
    expect(readFileSync(file, 'utf8')).toBe(original)

    // Back after the crash: the edit, unsaved, in the editor.
    app = await launch(f)
    win = await app.firstWindow()
    await expect(win.getByRole('tab', { name: /other\.md/ })).toHaveClass(/dirty/)
    await expect(editor(win).locator('h1')).toHaveText('Other — draft')
    expect(readFileSync(file, 'utf8')).toBe(original)

    // Save writes the file and the tab is clean.
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /other\.md/ })).not.toHaveClass(/dirty/)
    expect(readFileSync(file, 'utf8')).toBe('# Other — draft\n\nThe second document.\n')
    await app.close()

    // Nothing unsaved is left over: the file opens as it is.
    app = await launch(f)
    win = await app.firstWindow()
    await expect(win.getByRole('tab', { name: /other\.md/ })).not.toHaveClass(/dirty/)
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('a quick note survives a restart without a file, then is saved into Shared', async () => {
  const f = fixture()
  let app = await launch(f)
  try {
    let win = await app.firstWindow()
    // The window is ready when its sidebar is.
    await expect(win.getByTestId('shared')).toBeVisible()
    await win.keyboard.press(`${mod}+n`)
    await expect(editor(win)).toBeVisible({ timeout: 20_000 })
    await editor(win).click()
    await win.keyboard.type('Call the bank tomorrow')
    await expect(win.getByRole('tab', { name: /Call the bank tomorrow/ })).toHaveClass(/dirty/)
    await settle(win)
    // A normal close asks nothing: the note is already on disk.
    await app.close()

    app = await launch(f)
    win = await app.firstWindow()
    const tab = win.getByRole('tab', { name: /Call the bank tomorrow/ })
    await expect(tab).toHaveClass(/note/)
    await expect(editor(win)).toContainText('Call the bank tomorrow')

    // Save As: into Shared, by the note's first line.
    const shared = await app.evaluate(({ dialog }, dir) => {
      let asked = ''
      dialog.showSaveDialog = (async (_w: unknown, o: { defaultPath?: string }) => {
        asked = o.defaultPath ?? ''
        return { canceled: false, filePath: o.defaultPath }
      }) as unknown as typeof dialog.showSaveDialog
      ;(globalThis as Record<string, unknown>).__asked = () => asked
      return dir
    }, f.data)
    await win.keyboard.press(`${mod}+s`)
    const saved = join(shared, 'library', 'Call the bank tomorrow.md')
    await expect.poll(() => existsSync(saved)).toBe(true)
    expect(readFileSync(saved, 'utf8')).toBe('Call the bank tomorrow\n')
    await expect(win.getByRole('tab', { name: /Call the bank tomorrow\.md/ })).not.toHaveClass(/dirty/)
    // It is a document of Shared now: in the sidebar.
    await expect(win.getByTestId('shared').locator('.row', { hasText: 'Call the bank tomorrow.md' })).toBeVisible()
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('the file changed on disk during an edit: both are kept, nothing is overwritten', async () => {
  const f = fixture()
  const file = join(f.folder, 'other.md')
  const app = await launch(f, file)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('toggle-edit').click()
    await expect(editor(win)).toBeVisible({ timeout: 20_000 })
    await typeInHeading(win, ' — mine')
    await settle(win)
    writeFileSync(file, '# Other — theirs\n')
    await expect(win.getByTestId('notice')).toBeVisible()

    // Save refuses to overwrite silently; keeping mine, then saving, does.
    await win.keyboard.press(`${mod}+s`)
    expect(readFileSync(file, 'utf8')).toBe('# Other — theirs\n')
    await win.getByTestId('notice').getByRole('button', { name: /Keep my version|Оставить мою версию/ }).click()
    await win.keyboard.press(`${mod}+s`)
    await expect.poll(() => readFileSync(file, 'utf8')).toBe('# Other — mine\n\nThe second document.\n')
  } finally {
    await app.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('closing an edited tab asks; Don\'t Save drops the edit', async () => {
  const f = fixture()
  const file = join(f.folder, 'other.md')
  const original = readFileSync(file, 'utf8')
  const app = await launch(f, file)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('toggle-edit').click()
    await expect(editor(win)).toBeVisible({ timeout: 20_000 })
    await typeInHeading(win, ' — scratch')
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox
    })
    await win.keyboard.press(`${mod}+w`)
    await expect(win.getByRole('tab', { name: /other\.md/ })).toHaveCount(0)
    expect(readFileSync(file, 'utf8')).toBe(original)
  } finally {
    await app.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})
