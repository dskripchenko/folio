import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, type Fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const launch = (f: Fixture, pause: number) =>
  electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data, FOLIO_COMMIT_PAUSE: String(pause) } })

async function addProject(app: ElectronApplication, win: Page, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
  }, [dir])
  await win.getByTestId('add-project').click()
  await win.getByTestId('add-folder').click()
}

async function openInTree(win: Page, project: string, file: string): Promise<void> {
  const p = win.getByTestId('projects').locator('.project', { hasText: project })
  if ((await p.locator('.tree').count()) === 0) await p.locator('.project-row').click()
  await p.locator('.row', { hasText: file }).click()
}

async function editHeading(win: Page, text: string): Promise<void> {
  if ((await win.locator('article.doc:not([hidden]) dsk-markdown-editor').count()) === 0) await win.getByTestId('mode-visual').click()
  const h1 = win.locator('article.doc:not([hidden]) dsk-markdown-editor [contenteditable="true"] h1').first()
  await h1.click()
  await win.keyboard.press('End')
  await win.keyboard.type(text)
}

test('a folder keeps a history: started from folio, commits on save, versions compared and restored, status in the tree', async () => {
  const f = fixture()
  const proj = join(f.root, 'handbook')
  mkdirSync(join(proj, 'guides'), { recursive: true })
  writeFileSync(join(proj, 'guides', 'setup.md'), '# Setup\n\nInstall it.\n')
  let app = await launch(f, 2500)
  try {
    let win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await addProject(app, win, proj)
    await openInTree(win, 'handbook', 'guides')
    await openInTree(win, 'handbook', 'setup.md')

    // No history yet: start it.
    await win.getByTestId('toggle-history').click()
    const panel = win.getByTestId('history')
    await panel.getByRole('button', { name: /Keep a history|Вести историю/ }).click()
    await expect(panel.getByTestId('branch')).toHaveText('main')
    await expect(panel.getByTestId('versions').locator('.message')).toHaveText(['Start the history'])
    await expect(panel.getByTestId('auto-commit')).toBeChecked()
    await expect(win.getByTestId('projects').locator('.branch-badge')).toHaveText('main')

    // A save is committed after the pause.
    await editHeading(win, ' and run')
    await win.keyboard.press(`${mod}+s`)
    await expect(panel.getByTestId('versions').locator('.message')).toHaveText(['Update guides/setup.md', 'Start the history'], { timeout: 15_000 })

    // The first version: as it was, its changes, side by side; restored as an unsaved edit.
    await panel.getByTestId('versions').locator('li').nth(1).click()
    const doc = win.locator('article.doc:not([hidden])')
    await expect(doc.getByTestId('version-bar')).toBeVisible()
    await expect(doc.locator('dsk-markdown h1')).toHaveText('Setup')
    await doc.getByRole('button', { name: /Changes|Изменения/ }).click()
    await expect(doc.getByTestId('diff').locator('.del')).toHaveText(['# Setup'])
    await expect(doc.getByTestId('diff').locator('.add')).toHaveText(['# Setup and run'])
    await doc.getByRole('button', { name: /Side by side|Рядом/ }).click()
    await expect(doc.locator('.side-by-side dsk-markdown h1')).toHaveText(['Setup', 'Setup and run'])
    await doc.getByRole('button', { name: /Restore this version|Вернуть эту версию/ }).click()
    await expect(win.getByRole('tab', { name: /setup\.md/ })).toHaveClass(/dirty/)
    expect(readFileSync(join(proj, 'guides', 'setup.md'), 'utf8')).toBe('# Setup and run\n\nInstall it.\n')

    // Saved with a message of one's own, at once.
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /setup\.md/ })).not.toHaveClass(/dirty/)
    await panel.getByTestId('commit-message').fill('Back to the short title')
    await panel.getByRole('button', { name: /^(Commit|Зафиксировать)$/ }).click()
    await expect(panel.getByTestId('versions').locator('.message').first()).toHaveText('Back to the short title')

    // Status in the tree: a file changed elsewhere, its folder marked.
    writeFileSync(join(proj, 'guides', 'setup.md'), '# Setup\n\nChanged outside.\n')
    const tree = win.getByTestId('projects')
    await expect(tree.locator('.row', { hasText: 'setup.md' })).toHaveAttribute('data-status', 'modified')
    await expect(tree.locator('.row.dir', { hasText: 'guides' })).toHaveClass(/changed/)
    await app.close()

    // Leaving folio commits what waits (a long pause: only leaving commits it).
    app = await launch(f, 600_000)
    win = await app.firstWindow()
    await expect(win.getByRole('tab', { name: /setup\.md/ })).toBeVisible()
    await editHeading(win, ' (final)')
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /setup\.md/ })).not.toHaveClass(/dirty/)
    await app.close()
    app = await launch(f, 600_000)
    win = await app.firstWindow()
    await win.getByRole('tab', { name: /setup\.md/ }).click()
    if (!(await win.getByTestId('history').isVisible())) await win.getByTestId('toggle-history').click()
    await expect(win.getByTestId('versions').locator('.message').first()).toHaveText('Update guides/setup.md')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
