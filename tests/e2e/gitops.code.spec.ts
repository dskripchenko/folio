import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('git beyond committing: put aside and taken back, the last commit amended, a commit undone and tagged, branches renamed and deleted', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'a.txt'), 'one\n')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: proj, encoding: 'utf8' })
  git('init', '-q', '--initial-branch=main')
  git('add', '.')
  git('commit', '-qm', 'start')
  writeFileSync(join(proj, 'a.txt'), 'two\n')
  git('commit', '-qam', 'second')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
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
    await project.locator('.tree .row', { hasText: 'a.txt' }).click()

    // Put aside: a change and a new file; the files back to the last commit; taken back.
    writeFileSync(join(proj, 'a.txt'), 'three\n')
    writeFileSync(join(proj, 'new.txt'), 'new\n')
    await win.keyboard.press('Control+Shift+G')
    const panel = win.getByTestId('changes-panel')
    await expect(panel.getByTestId('change')).toHaveCount(2)
    await panel.getByTestId('changes-message').fill('half done')
    await panel.getByTestId('changes-stash').click()
    await expect.poll(() => readFileSync(join(proj, 'a.txt'), 'utf8')).toBe('two\n')
    await expect(panel.getByTestId('stash')).toHaveText(/half done/)
    await panel.getByTestId('stash-pop').click()
    await expect.poll(() => readFileSync(join(proj, 'a.txt'), 'utf8')).toBe('three\n')
    await expect(panel.getByTestId('stash')).toHaveCount(0)

    // Amend: the last commit's message to start from; still two commits.
    await panel.getByTestId('changes-unstaged-all').click()
    await panel.getByTestId('changes-message').fill('')
    await panel.getByTestId('changes-amend').check()
    await expect(panel.getByTestId('changes-message')).toHaveValue('second')
    await panel.getByTestId('changes-message').fill('second, with three')
    await panel.getByTestId('changes-commit').click()
    await expect.poll(() => git('log', '--format=%s').trim().split('\n')).toEqual(['second, with three', 'start'])

    // The history: a tag on the last commit, then that commit undone by a new one.
    await win.keyboard.press('Control+Shift+G')
    await win.getByTestId('toggle-history').click()
    const history = win.getByTestId('history')
    await history.getByTestId('scope-all').click()
    const top = history.getByTestId('versions').locator('li').first()
    await expect(top).toContainText('second, with three')
    await top.click({ button: 'right' })
    await win.getByTestId('commit-tag').click()
    await history.getByTestId('history-ask').locator('input').fill('v1.0.0 The first release')
    await history.getByTestId('history-ask').locator('input').press('Enter')
    await expect(top.locator('.ref.tag')).toHaveText('v1.0.0')
    expect(git('tag', '-n1').trim()).toMatch(/^v1\.0\.0\s+The first release/)
    await top.click({ button: 'right' })
    await win.getByTestId('commit-revert').click()
    await expect.poll(() => readFileSync(join(proj, 'a.txt'), 'utf8')).toBe('one\n')
    await expect(history.getByTestId('versions').locator('li').first()).toContainText(/Revert/)

    // Branches: made, renamed while checked out, then deleted from another.
    await history.getByTestId('branch').click()
    await history.getByTestId('new-branch').fill('topic')
    await history.getByTestId('branch-menu').getByRole('button', { name: /^(Create|Создать)$/ }).click()
    await expect(history.getByTestId('branch')).toHaveText('topic')
    await history.getByTestId('branch').click()
    await history.locator('[data-testid="branch-row"][data-branch="topic"]').getByTestId('branch-rename').click()
    await history.getByTestId('history-ask').locator('input').fill('feature/x')
    await history.getByTestId('history-ask').locator('input').press('Enter')
    await expect(history.getByTestId('branch')).toHaveText('feature/x')
    await history.getByTestId('branch').click()
    await history.locator('[data-testid="branch-row"][data-branch="main"]').locator('button').first().click()
    await expect(history.getByTestId('branch')).toHaveText('main')
    await history.getByTestId('branch').click()
    await history.locator('[data-testid="branch-row"][data-branch="feature/x"]').getByTestId('branch-delete').click()
    await expect.poll(() => git('branch', '--format=%(refname:short)').trim()).toBe('main')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
