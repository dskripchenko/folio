import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('files from the tree: made, renamed, moved by dragging, put in the trash; open tabs follow', async () => {
  const f = fixture()
  const proj = join(f.root, 'garden')
  mkdirSync(proj, { recursive: true })
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog, shell }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      // The trash: confirmed, and the file removed (a CI machine may have no trash).
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
      shell.trashItem = async (p: string) => (process.getBuiltinModule('node:fs') as typeof import('node:fs')).rmSync(p, { recursive: true, force: true, maxRetries: 5 })
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'garden' })
    await project.locator('.project-row').click()
    const root = await project.locator('ul.tree').first().getAttribute('data-root')
    const menu = (channel: string, value: object) => app.evaluate(({ BrowserWindow }, [c, v]) => BrowserWindow.getAllWindows()[0]!.webContents.send(c as string, v), [channel, value] as const)

    // A new note: its name typed in place; it opens.
    await menu('tree:create', { root, dir: '', kind: 'note' })
    const name = win.getByTestId('tree-name')
    await expect(name).toBeFocused()
    await name.fill('Ideas')
    await name.press('Enter')
    await expect(win.getByRole('tab', { name: /Ideas\.md/ })).toHaveAttribute('aria-selected', 'true')
    expect(readFileSync(join(proj, 'Ideas.md'), 'utf8')).toBe('# Ideas\n\n')
    const tree = project.locator('.tree')
    await expect(tree.locator('.row', { hasText: 'Ideas.md' })).toBeVisible()

    // A folder; a name that cannot be one is refused in place.
    await menu('tree:create', { root, dir: '', kind: 'folder' })
    // The new field, not the last one: it takes the focus once drawn.
    await expect(name).toBeFocused()
    await name.fill('a/b')
    await name.press('Enter')
    await expect(name).toHaveClass(/invalid/)
    await name.fill('drafts')
    await name.press('Enter')
    await expect(tree.locator('.row.dir', { hasText: 'drafts' })).toBeVisible()
    expect(existsSync(join(proj, 'drafts'))).toBe(true)

    // F2: renamed in place, the extension kept; the open tab follows.
    await tree.locator('.row', { hasText: 'Ideas.md' }).focus()
    await win.keyboard.press('F2')
    await expect(name).toHaveValue('Ideas.md')
    await win.keyboard.type('Plans')
    await win.keyboard.press('Enter')
    await expect(tree.locator('.row', { hasText: 'Plans.md' })).toBeVisible()
    expect(existsSync(join(proj, 'Plans.md'))).toBe(true)
    await expect(win.getByRole('tab', { name: /Plans\.md/ })).toBeVisible()

    // Dragged onto a folder: moved there; the tab follows again.
    const dt = await win.evaluateHandle(() => new DataTransfer())
    await tree.locator('.row', { hasText: 'Plans.md' }).dispatchEvent('dragstart', { dataTransfer: dt })
    await tree.locator('.row.dir', { hasText: 'drafts' }).dispatchEvent('dragover', { dataTransfer: dt })
    await tree.locator('.row.dir', { hasText: 'drafts' }).dispatchEvent('drop', { dataTransfer: dt })
    await expect.poll(() => existsSync(join(proj, 'drafts', 'Plans.md'))).toBe(true)
    await expect(win.getByRole('tab', { name: /Plans\.md/ })).toHaveAttribute('title', /drafts[\\/]Plans\.md$/)
    // Into the trash with Delete: the file goes, its tab closes.
    const drafts = tree.locator('.row.dir', { hasText: 'drafts' })
    if (!(await drafts.getAttribute('class'))?.includes('open')) await drafts.click()
    await tree.locator('.row', { hasText: 'Plans.md' }).focus()
    await win.keyboard.press('Delete')
    await expect.poll(() => existsSync(join(proj, 'drafts', 'Plans.md'))).toBe(false)
    await expect(win.getByRole('tab', { name: /Plans\.md/ })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
