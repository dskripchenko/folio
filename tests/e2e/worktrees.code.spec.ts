import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('worktrees: an agent’s listed with where it stands, reviewed against the base, opened as a project with its changes, taken without a commit, removed', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(proj, { recursive: true })
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'a.ts'), 'export const a = 1\n')
  git(proj, 'init', '-q', '--initial-branch=main')
  git(proj, 'config', 'core.autocrlf', 'false')
  git(proj, 'add', '.')
  git(proj, 'commit', '-qm', 'start')
  // An agent's worktree, where Claude Code keeps them: a commit and an edit not committed.
  const wt = join(proj, '.claude', 'worktrees', 'agent-x')
  git(proj, 'worktree', 'add', '-q', '-b', 'agent-x', wt)
  writeFileSync(join(wt, 'a.ts'), 'export const a = 2\n')
  git(wt, 'commit', '-qam', 'agent: a is 2')
  writeFileSync(join(wt, 'b.ts'), 'export const b = 1\n')
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
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' }).first()
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'package.json' }).click()

    // Listed: the main copy, and the agent's — a commit ahead, a file not committed.
    await win.getByTestId('toggle-worktrees').click()
    const panel = win.getByTestId('worktrees-panel')
    await expect(panel.getByTestId('worktree')).toHaveCount(2)
    const agent = panel.getByTestId('worktree').filter({ hasText: 'agent-x' })
    await expect(agent.getByTestId('worktree-meta')).toHaveText(/↑1 ↓0 · 1\D/)

    // Its work against the base: the commit and the new file.
    await agent.getByTestId('worktree-review').click()
    const review = win.locator('[data-testid="review"]:visible')
    await expect(review.getByTestId('review-file')).toHaveCount(2)
    await expect(review.locator('[data-path="a.ts"] .rv-add .rv-code')).toHaveText(/a = 2/)

    // Opened as a project: its changes panel works there (the system's git).
    await agent.getByTestId('worktree-more').click()
    await win.getByTestId('worktree-project').click()
    const wtProject = win.getByTestId('projects').locator('.project', { hasText: 'agent-x' })
    await expect(wtProject).toBeVisible()
    await wtProject.locator('.project-row').click()
    await wtProject.locator('.tree .row', { hasText: 'b.ts' }).click()
    await win.getByTestId('toggle-changes').click()
    await expect(win.getByTestId('changes-panel').getByTestId('change')).toHaveCount(1)

    // Taken into the main copy without a commit.
    await win.getByRole('tab', { name: /package\.json/ }).click()
    await agent.getByTestId('worktree-more').click()
    await win.getByTestId('worktree-take').click()
    await expect.poll(() => readFileSync(join(proj, 'a.ts'), 'utf8')).toBe('export const a = 2\n')
    expect(readFileSync(join(proj, 'b.ts'), 'utf8')).toBe('export const b = 1\n')
    expect(git(proj, 'log', '--oneline').trim().split('\n')).toHaveLength(1)

    // Removed, asked first: its folder and branch gone.
    await agent.getByTestId('worktree-more').click()
    await win.getByTestId('worktree-remove').click()
    await expect(panel.getByTestId('worktree')).toHaveCount(1)
    expect(existsSync(wt)).toBe(false)
    expect(git(proj, 'branch', '--list', 'agent-x')).toBe('')
    // Its project let go too.
    await expect(wtProject).toHaveCount(0)
  } finally {
    await app.close()
  }
})
