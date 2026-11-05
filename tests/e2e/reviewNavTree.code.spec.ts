import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('files by type: a mark in the stack’s colour in the tree and the review; the review’s files as a tree, a folder closed', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(join(proj, 'src', 'http', 'controllers'), { recursive: true })
  mkdirSync(join(proj, 'web'), { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: proj, encoding: 'utf8' })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  git('init', '-q', '--initial-branch=main')
  git('add', '.')
  git('commit', '-qm', 'start')
  writeFileSync(join(proj, 'src', 'http', 'controllers', 'Home.php'), '<?php\necho 1;\n')
  writeFileSync(join(proj, 'src', 'http', 'controllers', 'User.php'), '<?php\necho 2;\n')
  writeFileSync(join(proj, 'web', 'app.ts'), 'export const a = 1\n')
  writeFileSync(join(proj, 'web', 'main.js'), 'console.log(1)\n')
  writeFileSync(join(proj, 'README.md'), '# App\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    // Wide enough for the review's list of files.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 760))
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await project.locator('.project-row').click()
    // The tree: package.json with npm's mark.
    await expect(project.locator('.tree .row', { hasText: 'package.json' }).locator('.ft')).toHaveText('N')
    await project.locator('.tree .row', { hasText: 'web' }).click()
    await expect(project.locator('.tree .row', { hasText: 'app.ts' }).locator('.ft')).toHaveText('TS')
    await expect(project.locator('.tree .row', { hasText: 'main.js' }).locator('.ft')).toHaveText('JS')
    await project.locator('.tree .row', { hasText: 'package.json' }).click()

    await win.keyboard.press('Control+Shift+G')
    await expect(win.getByTestId('changes-panel').getByTestId('change').filter({ hasText: 'Home.php' }).locator('.ft')).toHaveText('<?')
    if (process.env.FOLIO_SHOTS) await win.screenshot({ path: join(process.env.FOLIO_SHOTS, 'tree.png') })
    await win.getByTestId('changes-panel').getByTestId('changes-review').click()
    const review = win.getByTestId('review')
    // Room for the list of files on a small screen: the panel and the sidebar put away.
    await win.getByTestId('toggle-changes').click()
    await expect(win.getByTestId('changes-panel')).toBeHidden()
    await win.getByTestId('side-collapse').click()
    const nav = review.getByTestId('review-nav')
    await expect(nav).toHaveCount(5)
    await expect(nav.filter({ hasText: 'Home.php' }).locator('.ft')).toHaveText('<?')

    // As a tree: folders first, a lone folder chain as one row.
    await review.getByTestId('review-nav-mode').click()
    const folders = review.getByTestId('review-nav-folder')
    await expect(folders).toHaveText(['src/http/controllers', 'web'])
    await expect(review.locator('.rv-nav li')).toHaveText([/controllers/, /Home\.php/, /User\.php/, /^web$/, /app\.ts/, /main\.js/, /README\.md/])
    if (process.env.FOLIO_SHOTS) await win.screenshot({ path: join(process.env.FOLIO_SHOTS, 'review-tree.png') })
    // A folder closed: its files out of the list.
    await folders.filter({ hasText: 'controllers' }).click()
    await expect(nav).toHaveCount(3)
    await folders.filter({ hasText: 'controllers' }).click()
    await expect(nav).toHaveCount(5)
    // Back to the list.
    await review.getByTestId('review-nav-mode').click()
    await expect(folders).toHaveCount(0)
    await expect(nav).toHaveCount(5)
  } finally {
    await app.close()
  }
})
