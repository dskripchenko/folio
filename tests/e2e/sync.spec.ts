import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

test('a repository cloned as a project: sync both ways, branches, a conflict resolved in the text', async () => {
  const f = fixture()
  // The team's remote, with a first document; Bob works in a clone of his own.
  const bare = join(f.root, 'team.git')
  git(f.root, 'init', '--bare', bare)
  const bob = join(f.root, 'bob')
  git(f.root, 'clone', bare, bob)
  writeFileSync(join(bob, 'notes.md'), '# Notes\n\nFirst line.\n')
  git(bob, 'add', '.')
  git(bob, 'commit', '-m', 'Start')
  git(bob, 'push', 'origin', 'HEAD:main')
  const bobSays = (text: string, message: string) => {
    git(bob, 'pull', '--no-rebase', 'origin', 'main')
    writeFileSync(join(bob, 'notes.md'), text)
    git(bob, 'commit', '-am', message)
    git(bob, 'push', 'origin', 'HEAD:main')
  }

  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data, FOLIO_COMMIT_PAUSE: '600000' } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()

    // Clone: the address here, the folder in the (stubbed) system dialog.
    await app.evaluate(({ dialog }, parent) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [parent] })) as typeof dialog.showOpenDialog
    }, f.root)
    await win.getByTestId('sidebar').getByRole('button', { name: /Clone a repository|Клонировать репозиторий/ }).click()
    await win.getByTestId('clone-url').fill(bare)
    await win.getByTestId('clone').getByRole('button', { name: /^(Clone…|Клонировать…)$/ }).click()
    await expect(win.getByTestId('clone')).toHaveCount(0)
    const team = join(f.root, 'team')
    const project = win.getByTestId('projects').locator('.project', { hasText: 'team' })
    await project.locator('.project-row').click()
    await project.locator('.row', { hasText: 'notes.md' }).click()
    await expect(win.locator('article.doc:not([hidden]) dsk-markdown h1')).toHaveText('Notes')

    await win.getByTestId('toggle-history').click()
    const panel = win.getByTestId('history')
    await expect(panel.getByTestId('branch')).toHaveText('main')
    await expect(panel.locator('.remote-url')).toContainText('team')
    const note = panel.getByTestId('git-note')
    await panel.getByTestId('sync').click()
    await expect(note).toHaveText(/Up to date|Всё совпадает/)

    // Bob's change comes in, and the open document shows it.
    bobSays('# Notes\n\nFirst line.\n\nBob was here.\n', 'Bob adds a line')
    await panel.getByTestId('sync').click()
    await expect(note).toHaveText(/Received|Получено/)
    await expect(win.locator('article.doc:not([hidden]) dsk-markdown p').last()).toHaveText('Bob was here.')

    // A branch, made and left.
    await panel.getByTestId('branch').click()
    await panel.getByTestId('new-branch').fill('draft')
    await panel.getByTestId('branch-menu').getByRole('button', { name: /^(Create|Создать)$/ }).click()
    await expect(panel.getByTestId('branch')).toHaveText('draft')
    await panel.getByTestId('branch').click()
    await panel.getByTestId('branch-menu').getByRole('button', { name: 'main', exact: true }).click()
    await expect(panel.getByTestId('branch')).toHaveText('main')

    // Both change the title: the merge stops with the conflict in the text.
    await win.getByTestId('toggle-edit').click()
    const h1 = win.locator('article.doc:not([hidden]) dsk-markdown-editor [contenteditable="true"] h1').first()
    await h1.click()
    await win.keyboard.press('End')
    await win.keyboard.type(' by Ann')
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /notes\.md/ })).not.toHaveClass(/dirty/)
    bobSays('# Notes by Bob\n\nFirst line.\n\nBob was here.\n', 'Bob renames')
    await panel.getByTestId('sync').click()
    await expect(note).toHaveText(/Conflicts|Конфликты/)
    const merge = panel.getByTestId('merge')
    await expect(merge.locator('li')).toHaveText(['notes.md'])
    expect(readFileSync(join(team, 'notes.md'), 'utf8')).toMatch(/<<<<<<< [^\n]*\n# Notes by Ann\n=======\n# Notes by Bob\n>>>>>>> /)
    await expect(panel.getByTestId('commit-message')).toHaveCount(0)

    // Finishing with the markers still there is refused; resolved, it is merged and sent.
    await merge.getByRole('button', { name: /Finish the merge|Завершить слияние/ }).click()
    await expect(note).toHaveText(/Conflict markers|Маркеры конфликта/)
    writeFileSync(join(team, 'notes.md'), '# Notes by Ann and Bob\n\nFirst line.\n\nBob was here.\n')
    await expect(merge).toContainText(/every conflict is resolved|все конфликты разрешены/)
    await merge.getByRole('button', { name: /Finish the merge|Завершить слияние/ }).click()
    await expect(panel.getByTestId('merge')).toHaveCount(0)
    await expect(panel.getByTestId('versions').locator('.message').first()).toHaveText(/^Merge origin\/main into main/)
    await expect(panel.getByTestId('sync')).toHaveText(/↑2 ↓0/)

    // The graph beside the versions: the merge is a ring joining two lanes.
    const graph = panel.getByTestId('graph')
    // A dot for each version (counted together: the panel may be drawn again meanwhile).
    await expect.poll(() => panel.evaluate((el) => el.querySelectorAll('[data-testid="graph"] circle.dg-commit-dot').length - el.querySelectorAll('[data-testid="versions"] li').length)).toBe(0)
    await expect(graph.locator('circle.dg-commit-merge')).toHaveCount(1)
    // Every commit of the repository, with its branches named.
    await panel.getByTestId('scope-all').click()
    await expect(panel.getByTestId('versions').locator('li').first().locator('.ref.head')).toHaveText('main')
    await expect(panel.getByTestId('versions').locator('.ref', { hasText: 'draft' })).toHaveCount(1)
    await expect(panel.getByTestId('versions').locator('.ref', { hasText: 'origin/main' })).toHaveCount(1)
    await expect(graph.locator('circle.dg-commit-head')).toHaveCount(1)
    await panel.getByTestId('scope-file').click()
    await panel.getByTestId('sync').click()
    await expect(note).toHaveText(/Sent|Отправлено/)
    git(bob, 'pull', '--no-rebase', 'origin', 'main')
    expect(readFileSync(join(bob, 'notes.md'), 'utf8')).toContain('# Notes by Ann and Bob')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
