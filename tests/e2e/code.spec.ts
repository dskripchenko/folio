import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

test('code, data and logs: listed in the tree, shown numbered in the colours of their language, edited as text', async () => {
  const f = fixture()
  const proj = join(f.root, 'service')
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'src', 'main.rs'), 'fn main() {\n    let s = "hi"; // greet\n    println!("{}", s);\n}\n')
  writeFileSync(join(proj, 'package.json'), '{\n  "name": "service",\n  "private": true\n}\n')
  writeFileSync(join(proj, 'app.log'), '2026-11-01T10:00:00Z ERROR <b>not markup</b> & more\n2026-11-01T10:00:01Z INFO ok\n')
  writeFileSync(join(proj, 'deploy'), '#!/usr/bin/env bash\necho "$HOME"\n')
  writeFileSync(join(proj, 'image.bin'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(join(proj, 'README.md'), '# Service\n\nSee [main](src/main.rs).\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'service' })
    await project.locator('.project-row').click()
    const tree = project.locator('.tree')
    // Text files with a language are listed (a #! line names it); a binary file is not.
    for (const name of ['src', 'package.json', 'app.log', 'README.md']) await expect(tree.locator('.row', { hasText: name })).toBeVisible()
    await expect(tree.locator('.row', { hasText: 'image.bin' })).toHaveCount(0)

    // A link from a document opens the source in folio.
    await tree.locator('.row', { hasText: 'README.md' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await doc.getByRole('link', { name: 'main' }).click()
    await expect(win.getByRole('tab', { name: /main\.rs/ })).toHaveAttribute('aria-selected', 'true')
    const view = doc.getByTestId('code-view')
    await expect(view).toHaveAttribute('data-language', 'rust')
    await expect(view.locator('.code-line')).toHaveCount(4)
    await expect(view.locator('.sx-keyword').first()).toHaveText('fn')
    await expect(view.locator('.sx-string').first()).toHaveText('"hi"')
    await expect(view.locator('.sx-comment')).toHaveText('// greet')
    // The numbers are the gutter's, not the text's: a copy holds the code alone.
    expect(await view.locator('pre').evaluate((pre) => pre.textContent)).toBe('fn main() {\n    let s = "hi"; // greet\n    println!("{}", s);\n}')

    // A log: levels; the text is text, never markup.
    await tree.locator('.row', { hasText: 'app.log' }).click()
    await expect(doc.getByTestId('code-view')).toHaveAttribute('data-language', 'log')
    await expect(doc.locator('.sx-error')).toHaveText('ERROR')
    await expect(doc.locator('.sx-info')).toHaveText('INFO')
    await expect(doc.locator('.code-lines b')).toHaveCount(0)
    await expect(doc.locator('.code-line').first()).toContainText('<b>not markup</b> & more')

    // Edited as text, saved; drawn again in colour.
    await tree.locator('.row', { hasText: 'package.json' }).click()
    await expect(doc.locator('.sx-property').first()).toHaveText('"name"')
    await viewMode(win, 'visual')
    const source = doc.getByTestId('source')
    await source.click()
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await win.keyboard.type('\n')
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
    await expect(win.getByRole('tab', { name: /package\.json/ })).not.toHaveClass(/dirty/)
    await viewMode(win, 'read')
    await expect(doc.getByTestId('code-view')).toHaveAttribute('data-language', 'json')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
