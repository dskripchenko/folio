import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('comments on lines: made, kept where their line moves, sent to the agent’s console as one paste without Enter', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(proj, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: proj, encoding: 'utf8' })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'a.ts'), 'export const a = 1\nexport const b = 1\n')
  git('init', '-q', '--initial-branch=main')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('commit', '-qm', 'start')
  writeFileSync(join(proj, 'a.ts'), 'export const a = 1\nexport const b = 2\n')
  // A stand-in for an agent: takes a paste as one (bracketed paste) and keeps what it got.
  const got = join(f.root, 'got.txt')
  const agent = join(f.root, 'agent.cjs')
  writeFileSync(
    agent,
    `const fs = require('fs'); process.stdin.setRawMode && process.stdin.setRawMode(true); process.stdout.write('\\x1b[?2004hready\\r\\n');
     process.stdin.on('data', (d) => { fs.appendFileSync(${JSON.stringify(got)}, d); if (d.includes('\\x03')) process.exit(0) })`,
  )
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
    await win.getByTestId('toggle-changes').click()
    const review = win.locator('[data-testid="review"]:visible')
    const a = review.locator('[data-path="a.ts"]')

    // A comment on the changed line.
    const row = a.locator('tr.rv-row.rv-add[data-after="2"]')
    await row.hover()
    await row.getByTestId('review-comment-add').click()
    await a.getByTestId('review-comment-input').fill('Make b a named constant.')
    await a.getByTestId('review-comment-save').click()
    await expect(a.getByTestId('review-comment')).toHaveText(/Make b a named constant/)
    await expect(review.getByTestId('review-send')).toHaveText(/1/)

    // The line moves (two lines above it): the comment goes with it.
    writeFileSync(join(proj, 'a.ts'), '// one\n// two\nexport const a = 1\nexport const b = 2\n')
    await expect(a.locator('tr.rv-row[data-after="4"] + tr.rv-comment-row')).toBeVisible({ timeout: 10_000 })

    // The agent in a console.
    await win.getByTestId('toggle-console').click()
    const console = win.getByTestId('console').first()
    await expect(console).toBeVisible()
    await console.click()
    await win.keyboard.type(`node "${agent}"`)
    await win.keyboard.press('Enter')
    await expect(console).toContainText('ready', { timeout: 15_000 })

    // Sent: one paste, in the marks, without Enter; the comment marked as sent.
    await review.getByTestId('review-send').click()
    const dialog = win.getByTestId('review-send-dialog')
    await expect(dialog.getByTestId('review-send-text')).toHaveValue(/a\.ts:4[\s\S]*\+export const b = 2[\s\S]*Make b a named constant\./)
    await dialog.getByTestId('review-send-paste').click()
    await expect.poll(() => (existsSync(got) ? readFileSync(got, 'utf8') : '')).toContain('Make b a named constant.')
    const text = readFileSync(got, 'utf8')
    expect(text.startsWith('\x1b[200~')).toBe(true)
    expect(text.endsWith('\x1b[201~')).toBe(true)
    await expect(a.getByTestId('review-comment')).toHaveAttribute('data-sent', '')
    await expect(review.getByTestId('review-send')).toBeHidden()
  } finally {
    await app.close()
  }
})
