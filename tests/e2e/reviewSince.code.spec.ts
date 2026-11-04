import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('since the last look: all seen, an agent’s edits come up by themselves with their time, a file seen leaves; the changes panel counts them', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(proj, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: proj, encoding: 'utf8' })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(proj, 'b.ts'), 'export const b = 1\n')
  git('init', '-q', '--initial-branch=main')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('commit', '-qm', 'start')
  writeFileSync(join(proj, 'a.ts'), 'export const a = 2\n')
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
    await project.locator('.tree .row', { hasText: 'package.json' }).click()
    await win.getByTestId('toggle-changes').click()
    await win.getByTestId('changes-review').click()

    // From the working copy: since the last look (never looked: everything).
    await win.getByTestId('review').getByTestId('review-open-since').click()
    const since = win.locator('[data-testid="review"]:visible')
    await expect(since.getByTestId('review-file')).toHaveCount(1)
    await expect(since.getByTestId('review-all-seen')).toBeVisible()

    // All seen: nothing left; the panel counts nothing.
    await since.getByTestId('review-all-seen').click()
    await expect(since.getByTestId('review-file')).toHaveCount(0)
    await expect(win.getByTestId('changes-since')).toBeHidden()

    // An agent edits two files: they come up by themselves, the newest first, with when.
    writeFileSync(join(proj, 'b.ts'), 'export const b = 2\n')
    writeFileSync(join(proj, 'a.ts'), 'export const a = 3\n')
    await expect(since.getByTestId('review-file')).toHaveCount(2, { timeout: 10_000 })
    await expect(since.getByTestId('review-nav').first().locator('.rv-nav-when')).not.toHaveText('')
    // Only what changed since the look: a.ts from 2 to 3, not from 1.
    await expect(since.locator('[data-path="a.ts"] .rv-del .rv-code')).toHaveText(/a = 2/)
    await expect(win.getByTestId('changes-since')).toHaveText(/2/)

    // A file seen leaves the set.
    await since.locator('[data-path="b.ts"]').getByTestId('review-viewed').check()
    await expect(since.getByTestId('review-file')).toHaveCount(1)
    await expect(since.getByTestId('review-file')).toHaveAttribute('data-path', 'a.ts')
  } finally {
    await app.close()
  }
})
