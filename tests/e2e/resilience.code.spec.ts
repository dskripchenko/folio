import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const win32 = process.platform === 'win32'

const notified = (app: ElectronApplication) => app.evaluate(() => (globalThis as { folioNotified?: { title: string; body: string; consoleId: number | null }[] }).folioNotified ?? [])

async function typeIn(win: Page, line: string): Promise<void> {
  const pane = win.locator('.console-pane').first()
  await pane.click()
  await win.keyboard.type(line)
  await win.keyboard.press('Enter')
}

test('after a crash, said once; a long command and a program asking for attention told; what folio-data holds, its caches cleared; a console’s usage on its tab', async () => {
  const f = fixture()
  // The run before: started, never quit.
  mkdirSync(join(f.data, 'logs'), { recursive: true })
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  writeFileSync(join(f.data, 'logs', `folio-${day}.log`), JSON.stringify({ ts: new Date(Date.now() - 3600_000).toISOString(), level: 'info', proc: 'main', area: 'app', msg: 'start' }) + '\n')
  // Commands of a second or more are told of.
  writeFileSync(join(f.data, 'workspace.json'), JSON.stringify({ version: 1, shared: null, projects: [], welcomed: true, alerts: { commandSec: 1 } }))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()

    // The crash before: a note with the log at hand.
    const toast = win.getByTestId('res-toast')
    await expect(toast).toBeVisible()
    await expect(toast.locator('button')).toHaveCount(3)
    await toast.locator('button').last().click()
    await expect(toast).toBeHidden()

    // A command longer than a second ends: told (the window is not in front under test).
    await win.keyboard.press('Control+Backquote')
    await expect(win.getByTestId('console-panel')).toBeVisible()
    const pane = win.locator('.console-pane').first()
    await expect.poll(async () => (await pane.locator('.dsk-term-row').allTextContents()).join('').trim().length, { timeout: 20_000 }).toBeGreaterThan(0)
    await typeIn(win, win32 ? 'Start-Sleep 2' : 'sleep 2')
    await expect.poll(async () => (await notified(app)).length, { timeout: 15_000 }).toBe(1)
    const [done] = await notified(app)
    expect(done!.body).toContain(win32 ? 'Start-Sleep 2' : 'sleep 2')
    expect(done!.consoleId).toBe(1)

    // A program asks for attention while it runs (OSC 9, as Claude Code does).
    await typeIn(win, win32 ? 'Write-Host "$([char]27)]9;hello from the agent$([char]7)"; Start-Sleep 1' : "printf '\\033]9;hello from the agent\\007'; sleep 1")
    await expect.poll(async () => (await notified(app)).map((n) => n.body), { timeout: 15_000 }).toContain('hello from the agent')

    // What the console's programs take, on its tab (sampled often while the processes window is open).
    await win.getByTestId('res-gauge').click()
    await expect(win.getByTestId('processes')).toBeVisible()
    await expect(win.getByTestId('console-tab').first()).toHaveAttribute('data-usage', /\d/, { timeout: 15_000 })
    await expect(win.getByTestId('res-heap')).toContainText(/\d/)
    await win.keyboard.press('Escape')

    // folio-data told by its parts; caches cleared.
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('open-settings').click()
    await win.getByTestId('settings-app').click()
    await expect(win.getByTestId('settings-commandSec')).toHaveValue('1')
    await expect(win.getByTestId('settings-diskGb')).toHaveValue('5')
    await expect(win.getByTestId('settings-data-size')).toContainText('folio-data:')
    await win.getByTestId('settings-clear-caches').click()
    await expect(win.getByTestId('settings-app-status')).not.toBeEmpty()
  } finally {
    await app.close()
  }
})
