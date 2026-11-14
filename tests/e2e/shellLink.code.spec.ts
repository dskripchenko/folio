import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fixture } from './fixture'

test('the shell terminal, when it runs: the review’s comments pasted into its agent’s pane, nothing when it has none there', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(proj, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: proj, encoding: 'utf8' })
  writeFileSync(join(proj, 'a.ts'), 'export const a = 1\nexport const b = 1\n')
  git('init', '-q', '--initial-branch=main')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('commit', '-qm', 'start')
  writeFileSync(join(proj, 'a.ts'), 'export const a = 1\nexport const b = 2\n')

  // shell, a stand-in: its API kept as asked; the first paste finds no pane, the next one an agent's.
  const asked: { path: string; auth: string; body: Record<string, unknown> }[] = []
  let pastes = 0
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      asked.push({ path: req.url ?? '', auth: req.headers.authorization ?? '', body: JSON.parse(body || '{}') as Record<string, unknown> })
      if (req.url === '/api/look') {
        const t = { background: '#123456', foreground: '#fedcba', cursor: '#ffffff', selection: '#333333', ansi: Array(16).fill('#808080') }
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ light: t, dark: t, font: { family: 'Menlo', size: 13 } }))
      }
      if (req.url === '/api/projects') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ projects: [{ name: 'from-shell', root: shellProject, color: '#3b82f6' }] }))
      if (req.url === '/api/paste') {
        pastes++
        if (pastes === 1) return void res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"no pane"}')
        return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"pane":"p1","agent":"claude"}')
      }
      res.writeHead(204).end()
    })
  })
  const shellProject = join(f.root, 'from-shell')
  mkdirSync(shellProject)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  const presence = join(f.root, 'shell-presence.json')
  writeFileSync(presence, JSON.stringify({ pid: process.pid, version: '0.4.0', url: `http://127.0.0.1:${port}`, token: 'tok', capabilities: ['open-tab', 'paste', 'review', 'look', 'projects'] }))

  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data, SHELL_PRESENCE: presence } })
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
    await project.locator('.tree .row', { hasText: 'a.ts' }).click()
    await win.getByTestId('toggle-changes').click()
    await win.getByTestId('changes-review').click()
    await win.getByTestId('toggle-changes').click()
    const review = win.locator('[data-testid="review"]:visible')
    const a = review.locator('[data-path="a.ts"]')
    const row = a.locator('tr.rv-row.rv-add[data-after="2"]')
    await row.hover()
    await row.getByTestId('review-comment-add').click()
    await a.getByTestId('review-comment-input').fill('Make b a named constant.')
    await a.getByTestId('review-comment-save').click()

    await review.getByTestId('review-send').click()
    const dialog = win.getByTestId('review-send-dialog')
    const toShell = dialog.getByTestId('review-send-shell')
    await expect(toShell).toBeVisible()
    // No pane of shell in the repository: said, nothing marked sent.
    await toShell.click()
    await expect(dialog).toContainText('shell')
    await expect(a.getByTestId('review-comment')).not.toHaveAttribute('data-sent', '')
    // Pasted into the agent's pane: the comments marked sent.
    await toShell.click()
    await expect(dialog).toBeHidden()
    await expect(a.getByTestId('review-comment')).toHaveAttribute('data-sent', '')
    const paste = asked.filter((x) => x.path === '/api/paste').at(-1)!
    // shell's look in the consoles; its projects added from the palette.
    await win.keyboard.press('Control+Backquote')
    await expect.poll(() => win.getByTestId('console-panel').evaluate((e) => getComputedStyle(e).getPropertyValue('--console-bg').trim())).toBe('#123456')
    // From outside the console: there the keys are its program's.
    await win.getByTestId('toggle-console').click()
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    await win.keyboard.type('shell')
    await win.locator('[data-command="shell-projects"]').click()
    await expect(win.getByText('from-shell', { exact: true })).toBeVisible()
    await win.keyboard.press('Enter')
    await expect(win.getByTestId('projects').locator('.project', { hasText: 'from-shell' })).toHaveCount(1)
    expect(paste.auth).toBe('Bearer tok')
    expect(paste.body.repo).toBe(realpathSync(proj))
    expect(String(paste.body.text)).toMatch(/a\.ts[\s\S]*Make b a named constant\./)
  } finally {
    await app.close()
    server.close()
  }
})
