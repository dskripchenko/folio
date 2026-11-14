import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('a command line from another program: a file at a line, a project, a review; folio says where it runs', async () => {
  const f = fixture()
  const repo = join(f.root, 'app')
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: repo, encoding: 'utf8' })
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1\n')
  git('init', '-q', '--initial-branch=main')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('commit', '-qm', 'start')
  writeFileSync(join(repo, 'a.ts'), 'export const a = 2\n')
  const code = join(f.folder, 'long.ts')
  writeFileSync(code, Array.from({ length: 200 }, (_, i) => `export const v${i + 1} = ${i + 1}`).join('\n') + '\n')
  const presence = join(f.root, 'presence.json')

  const app = await electron.launch({ args: ['.', `${code}:150`, '--project', f.folder, '--review', repo], env: { ...process.env, FOLIO_DATA: f.data, FOLIO_PRESENCE: presence } })
  try {
    const win = await app.firstWindow()
    // The review of the repository's working copy, the project in the sidebar, the file at its line.
    await expect(win.getByTestId('review').getByTestId('review-file')).toHaveCount(1)
    await expect(win.getByTestId('projects').locator('.project', { hasText: 'notes' })).toHaveCount(1)
    await expect(win.getByRole('tab', { name: /long\.ts/ })).toHaveAttribute('aria-selected', 'true')
    await expect(win.getByText('export const v150 = 150')).toBeInViewport()

    // Where it runs, for the shell terminal; how to start it again with arguments.
    await expect.poll(() => existsSync(presence)).toBe(true)
    const p = JSON.parse(readFileSync(presence, 'utf8')) as { pid: number; launch: string[]; capabilities: string[] }
    expect(p.capabilities).toEqual(['open', 'line', 'project', 'review'])
    expect(p.pid).toBe(await app.evaluate(() => process.pid))
  } finally {
    await app.close()
  }
  // Gone with folio.
  expect(existsSync(presence)).toBe(false)
})
