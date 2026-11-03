import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('a project of code: its dot files shown, what .gitignore leaves out hidden and followed live; a binary file goes to the system', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(join(proj, '.git'), { recursive: true })
  mkdirSync(join(proj, '.github', 'workflows'), { recursive: true })
  mkdirSync(join(proj, 'src'), { recursive: true })
  mkdirSync(join(proj, 'dist'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, '.gitignore'), 'dist/\n')
  writeFileSync(join(proj, '.github', 'workflows', 'ci.yml'), 'on: push\n')
  writeFileSync(join(proj, 'src', 'main.ts'), 'export const a = 1\n')
  writeFileSync(join(proj, 'dist', 'main.js'), 'x\n')
  writeFileSync(join(proj, 'logo.bin'), Buffer.from([0, 1, 2, 0]))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog, shell }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      // The system's program is not started in a test: what it was given is kept.
      const g = globalThis as unknown as { opened: string[] }
      g.opened = []
      shell.openPath = (async (p: string) => {
        g.opened.push(p)
        return ''
      }) as typeof shell.openPath
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await project.locator('.project-row').click()
    const tree = project.locator('.tree')
    const row = (name: string) => tree.locator('.row', { hasText: name })
    for (const name of ['.github', 'src', '.gitignore', 'package.json', 'logo.bin']) await expect(row(name)).toBeVisible()
    await expect(row('dist')).toHaveCount(0)

    // .gitignore written: the tree follows.
    writeFileSync(join(proj, '.gitignore'), 'src/\n')
    await expect(row('dist')).toBeVisible()
    await expect(row('src')).toHaveCount(0)

    // A binary file: to the system's program, no tab.
    await row('logo.bin').click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.length)).toBe(1)
    await expect(win.getByRole('tab', { name: /logo\.bin/ })).toHaveCount(0)
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
