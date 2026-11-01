import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

/** Answer the next folder dialogs with these folders. */
async function pickFolders(app: ElectronApplication, ...dirs: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
  }, dirs)
}

test('projects in the sidebar: add, browse, open, follow the disk, group and pin, all kept across a restart', async () => {
  const f = fixture()
  const second = join(f.root, 'second')
  mkdirSync(join(second, 'guides'), { recursive: true })
  writeFileSync(join(second, 'guides', 'setup.md'), '# Setup\n')
  writeFileSync(join(second, 'README.md'), '# Second\n')
  writeFileSync(join(second, 'build.log'), 'not a document')
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })

  let app = await launch()
  try {
    let win = await app.firstWindow()
    const sidebar = win.getByTestId('sidebar')
    await expect(sidebar.getByTestId('shared')).toBeVisible()

    await pickFolders(app, f.folder, second)
    await sidebar.getByRole('button', { name: /Add a project folder|Добавить папку проекта/ }).click()
    const projects = sidebar.getByTestId('projects')
    await expect(projects.locator('.project-row')).toHaveText([/notes/, /second/])

    // A project's tree: folders first, only documents (build.log is left out).
    await projects.locator('.project-row', { hasText: 'second' }).click()
    const tree = projects.locator('.project', { hasText: 'second' })
    await expect(tree.locator('.tree > li > .row .name')).toHaveText(['guides', 'README.md'])
    await tree.locator('.row.dir', { hasText: 'guides' }).click()
    await tree.locator('.row', { hasText: 'setup.md' }).click()
    await expect(win.getByRole('tab', { name: /setup\.md/ })).toHaveAttribute('aria-selected', 'true')
    await expect(tree.locator('.row.active')).toHaveText(/setup\.md/)

    // The disk changes: the open document is drawn again, a new file shows up.
    writeFileSync(join(second, 'guides', 'setup.md'), '# Setup, revised\n')
    await expect(win.locator('article.doc:not([hidden]) h1')).toHaveText('Setup, revised')
    writeFileSync(join(second, 'guides', 'deploy.md'), '# Deploy\n')
    await expect(tree.locator('.row', { hasText: 'deploy.md' })).toBeVisible()

    // Group and pin (what the project menu does).
    const ids = await win.evaluate(async () => (await window.folio.workspace()).projects.map((p) => [p.name, p.id]))
    const id = Object.fromEntries(ids)
    await win.evaluate(async ([a, b]) => {
      await window.folio.updateProject(a, { group: 'Work' })
      await window.folio.updateProject(b, { pinned: true })
    }, [id.notes, id.second])
    await win.evaluate(async () => window.folio.workspace())
    await win.reload()
    await expect(projects.locator('.project-row, .group')).toHaveText([/second/, 'Work', /notes/])
    await app.close()

    // Everything comes back: the projects, the group, what was expanded.
    app = await launch()
    win = await app.firstWindow()
    const again = win.getByTestId('projects')
    await expect(again.locator('.project-row, .group')).toHaveText([/second/, 'Work', /notes/])
    await expect(again.locator('.row', { hasText: 'setup.md' })).toBeVisible()
  } finally {
    await app.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})
