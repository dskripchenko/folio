import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import electronPath from 'electron'
import { fixture } from './fixture'

interface Answer {
  id?: number
  result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }
}

/** An agent's side: folio's bridge started as Claude Code starts it — folio's executable as Node. */
function agent(bridge: string, info: string) {
  const p = spawn(electronPath as unknown as string, [bridge, info], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'inherit'] })
  const lines: Answer[] = []
  let rest = ''
  p.stdout.on('data', (d: Buffer) => {
    rest += d.toString()
    const parts = rest.split('\n')
    rest = parts.pop()!
    for (const l of parts) if (l.trim()) lines.push(JSON.parse(l) as Answer)
  })
  let seq = 0
  const call = (method: string, params?: unknown) => {
    const id = ++seq
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    return {
      id,
      answer: async (timeout = 15_000): Promise<Answer> => {
        await expect.poll(() => lines.some((l) => l.id === id), { timeout }).toBe(true)
        return lines.find((l) => l.id === id)!
      },
      answered: () => lines.some((l) => l.id === id),
    }
  }
  const tool = (name: string, args: Record<string, unknown>) => call('tools/call', { name, arguments: args })
  return { p, call, tool }
}

const text = (a: Answer) => a.result?.content?.[0]?.text ?? ''

test('an agent over MCP: changes shown and the answer awaited — comments back, then approved; comments read; a file opened; worktrees listed', async () => {
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
  git('worktree', 'add', '-q', '-b', 'agent/x', join(f.root, 'wt'))
  writeFileSync(join(proj, 'a.ts'), 'export const a = 1\nexport const b = 2\n')
  // Claude Code's command, a stand-in: what folio asks of it is kept.
  const asked = join(f.root, 'claude.log')
  const claude = join(f.root, 'claude')
  writeFileSync(claude, `#!/bin/sh\necho "$*" >> '${asked}'\n`)
  chmodSync(claude, 0o755)
  mkdirSync(join(proj, '.claude'))
  writeFileSync(join(proj, '.claude', 'settings.local.json'), '{}')

  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data, ...(process.platform === 'win32' ? {} : { FOLIO_CLAUDE: claude }) } })
  const info = join(f.data, 'review', 'mcp.json')
  const bridge = join(f.data, 'review', 'mcp-bridge.cjs')
  let a: ReturnType<typeof agent> | null = null
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await expect.poll(() => existsSync(info) && existsSync(bridge)).toBe(true)
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await project.locator('.project-row').click()

    a = agent(bridge, info)
    expect((await a.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }).answer()).result).toBeTruthy()
    expect((await a.call('tools/list').answer()).result?.tools?.map((t) => t.name)).toContain('show_changes')

    // Shown, with the agent's line; it waits while the person reads and comments.
    const first = a.tool('show_changes', { repo: join(proj, 'a.ts'), message: 'b is 2 now.' })
    const review = win.locator('[data-testid="review"]:visible')
    const ask = review.getByTestId('review-ask')
    await expect(ask).toBeVisible()
    await expect(ask.getByTestId('review-ask-message')).toHaveText('b is 2 now.')
    await expect(ask.getByTestId('review-ask-request')).toBeDisabled()
    const file = review.locator('[data-path="a.ts"]')
    const row = file.locator('tr.rv-row.rv-add[data-after="2"]')
    await row.hover()
    await row.getByTestId('review-comment-add').click()
    await file.getByTestId('review-comment-input').fill('Name it: MAX_B.')
    await file.getByTestId('review-comment-save').click()
    await win.waitForTimeout(500)
    expect(first.answered()).toBe(false)

    // Sent back: the comment with its file, line and rows.
    await ask.getByTestId('review-ask-request').click()
    await expect(ask).toBeHidden()
    const back = text(await first.answer())
    expect(back).toMatch(/^Changes requested\./)
    expect(back).toContain('a.ts:2')
    expect(back).toContain('+export const b = 2')
    expect(back).toContain('Name it: MAX_B.')
    await expect(file.getByTestId('review-comment')).toHaveAttribute('data-sent', '')

    // Read again later: nothing new; with all, the one given before.
    expect(text(await a.tool('get_review_comments', { repo: proj }).answer())).toBe('No comments.')
    expect(text(await a.tool('get_review_comments', { repo: proj, all: true }).answer())).toContain('Name it: MAX_B.')

    // Asked again: approved.
    const second = a.tool('show_changes', { repo: proj })
    await expect(ask).toBeVisible()
    await ask.getByTestId('review-ask-approve').click()
    expect(text(await second.answer())).toMatch(/^Approved/)

    // The agent stops waiting: the question goes from the review.
    const third = a.tool('show_changes', { repo: proj, message: 'Once more.' })
    await expect(ask.getByTestId('review-ask-message')).toHaveText('Once more.')
    void third

    // A file at a line; the worktrees.
    expect(text(await a.tool('open_file', { path: join(proj, 'package.json'), line: 1 }).answer())).toContain('Opened')
    await expect(win.getByRole('tab', { name: /package\.json/ })).toHaveAttribute('aria-selected', 'true')
    const wts = JSON.parse(text(await a.tool('list_worktrees', { repo: proj }).answer())) as { worktrees: { branch: string | null }[] }
    expect(wts.worktrees.map((w) => w.branch)).toEqual(['main', 'agent/x'])
    // Not a repository: said to the agent.
    const outside = await a.tool('list_worktrees', { repo: f.root }).answer()
    expect(outside.result?.isError).toBe(true)

    a.p.stdin.end()
    // The review's tab (its name is in the system's language): the project's name in it.
    await win.getByRole('tab', { name: /· app/ }).first().click()
    await expect(ask).toBeHidden()

    // Connected: Claude Code is asked to add the bridge for the project (local scope); disconnected, to remove it.
    if (process.platform !== 'win32') {
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
      await win.keyboard.type('Claude')
      await win.locator('[data-command="claude-connect"]').click()
      await expect.poll(() => (existsSync(asked) ? readFileSync(asked, 'utf8') : '')).toContain('mcp add --scope local --env ELECTRON_RUN_AS_NODE=1 folio --')
      expect(readFileSync(asked, 'utf8')).toContain(bridge)
    }
  } finally {
    a?.p.kill()
    await app.close()
  }
})
