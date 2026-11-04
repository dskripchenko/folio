import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const lines = (n: number) => Array.from({ length: n }, (_, i) => `export const v${i + 1} = ${i + 1}\n`).join('')

test('the review: the working copy as a pull request — a run staged, a file viewed, two columns, an agent’s edit shown, a line edited beside, a run thrown away', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(proj, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: proj, encoding: 'utf8' })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'a.ts'), lines(40))
  git('init', '-q', '--initial-branch=main')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('commit', '-qm', 'start')
  // Two runs in a.ts, far apart; a new file.
  writeFileSync(join(proj, 'a.ts'), lines(40).replace('v5 = 5', 'v5 = 50').replace('v30 = 30', 'v30 = 300'))
  writeFileSync(join(proj, 'notes.md'), '# Notes\n\nnew\n')
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  let app = await launch()
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'package.json' }).click()

    // From the changes panel: the working copy in a review tab.
    await win.keyboard.press('Control+Shift+G')
    await win.getByTestId('changes-panel').getByTestId('changes-review').click()
    const review = win.getByTestId('review')
    await expect(win.locator('.tab.review-tab')).toHaveAttribute('aria-selected', 'true')
    const files = review.getByTestId('review-file')
    await expect(files).toHaveCount(2)
    await expect(review.getByTestId('review-summary')).toHaveText(/2\D.*\+5 −2/)
    const a = review.locator('[data-path="a.ts"]')
    await expect(a.getByTestId('review-hunk')).toHaveCount(2)
    // The words changed within a line are marked.
    await expect(a.locator('.rv-add .rv-w').first()).toHaveText('50')

    // One run staged: git has it in the index; the other not.
    await a.getByTestId('review-hunk').first().locator('.rv-hunk-label').hover()
    await a.getByTestId('review-hunk-stage').first().click()
    await expect(a.getByTestId('review-hunk-state').first()).toHaveClass(/rv-badge-staged/)
    expect(git('diff', '--cached')).toContain('+export const v5 = 50')
    expect(git('diff', '--cached')).not.toContain('v30 = 300')

    // Viewed: folded, marked in the list.
    const notes = review.locator('[data-path="notes.md"]')
    await notes.getByTestId('review-viewed').check()
    await expect(notes).toHaveAttribute('data-viewed', '')
    await expect(review.getByTestId('review-nav').filter({ hasText: 'notes.md' })).toHaveAttribute('data-viewed', '')

    // Two columns.
    await review.getByTestId('review-split').click()
    await expect(a.locator('.rv-split .rv-pair').first()).toBeVisible()
    await review.getByTestId('review-unified').click()

    // An agent edits a file: the review shows it without asking; a viewed file changed is not viewed any more.
    writeFileSync(join(proj, 'notes.md'), '# Notes\n\nnew\nmore\n')
    await expect(notes).not.toHaveAttribute('data-viewed', '', { timeout: 10_000 })
    await expect(notes.locator('.rv-add .rv-code', { hasText: 'more' })).toBeVisible()

    // A double click on a line: the file beside, to edit, at that line.
    await a.locator('tr.rv-row[data-after="30"]').dblclick()
    await expect(win.getByRole('tab', { name: /a\.ts/ })).toHaveClass(/beside|shown/)
    await expect(win.locator('.dsk-code-editor').first()).toBeVisible()

    // The other run thrown away: the file as it was there.
    // (In the middle of the view: the sticky heads cover the top.)
    await a.getByTestId('review-hunk').nth(1).evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await a.getByTestId('review-hunk').nth(1).locator('.rv-hunk-label').hover()
    await a.getByTestId('review-hunk-discard').nth(1).click()
    await expect.poll(() => readFileSync(join(proj, 'a.ts'), 'utf8')).toContain('v30 = 30\n')
    await expect(a.getByTestId('review-hunk')).toHaveCount(1)
  } finally {
    await app.close()
  }

  // Kept across a restart: the review tab, its set read again.
  app = await launch()
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.tab.review-tab')).toHaveCount(1)
    await win.locator('.tab.review-tab').click()
    await expect(win.getByTestId('review').locator('[data-path="a.ts"]').getByTestId('review-hunk')).toHaveCount(1)
  } finally {
    await app.close()
  }
})
