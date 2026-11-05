import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const win32 = process.platform === 'win32'

test('what folio takes: the gauge, the processes window, a report, the log, the limits in the settings; kept awake, also while a command runs', async () => {
  const f = fixture()
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()

    // The gauge: folio's memory, sampled a second after start.
    const gauge = win.getByTestId('res-gauge')
    await expect(gauge.locator('.rail-gauge-value')).toHaveText(/^\d+(\.\d)?[MG]$/, { timeout: 20_000 })
    await expect(gauge).toHaveAttribute('data-state', 'ok')

    // The processes window: the main process and the window, with their memory.
    await gauge.click()
    const dialog = win.getByTestId('processes')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('res-row-main')).toBeVisible()
    await expect(dialog.getByTestId('res-row-window').first()).toBeVisible()
    await expect(dialog.getByTestId('res-total')).toContainText('folio')
    await expect(dialog.locator('.res-chart path')).toHaveAttribute('d', /^M/)

    // A report: a ZIP of the log and the versions, where people choose.
    const report = join(f.root, 'report.zip')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
    }, report)
    await dialog.getByTestId('res-report').click()
    await expect.poll(() => existsSync(report)).toBe(true)
    expect(readFileSync(report).subarray(0, 2).toString()).toBe('PK')
    await win.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // The log: a file today, its start written.
    const logs = join(f.data, 'logs')
    const files = readdirSync(logs).filter((n) => /^folio-\d{4}-\d{2}-\d{2}\.log$/.test(n))
    expect(files).toHaveLength(1)
    expect(readFileSync(join(logs, files[0]!), 'utf8')).toContain('"msg":"start"')

    // A soft limit below what folio takes: the gauge says so.
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('open-settings').click()
    await win.getByTestId('settings-app').click()
    await expect(win.getByTestId('settings-logDays')).toHaveValue('5')
    await expect(win.getByTestId('settings-softGb')).toHaveValue('4')
    await win.getByTestId('settings-softGb').fill('0.1')
    await win.getByTestId('settings-app-save').click()
    await expect(win.getByTestId('settings-app-status')).not.toBeEmpty()
    await win.keyboard.press('Escape')
    await expect(gauge).toHaveAttribute('data-state', 'over', { timeout: 30_000 })
    const workspace = JSON.parse(readFileSync(join(f.data, 'workspace.json'), 'utf8'))
    expect(workspace.limits).toEqual({ softGb: 0.1, lspGb: 2, heapGb: 0 })

    // Kept awake until turned off, then off.
    const awake = win.getByTestId('awake')
    await expect(awake).toHaveAttribute('data-state', 'off')
    await awake.click()
    await win.getByTestId('awake-on').click()
    await expect(awake).toHaveAttribute('data-state', 'on')
    await awake.click()
    await win.getByTestId('awake-off').click()
    await expect(awake).toHaveAttribute('data-state', 'off')

    // The display stays on by default; letting it sleep is remembered.
    await awake.click()
    await expect(win.getByTestId('awake-display')).toHaveAttribute('aria-checked', 'false')
    await win.getByTestId('awake-display').click()
    await expect.poll(() => JSON.parse(readFileSync(join(f.data, 'workspace.json'), 'utf8')).awakeDisplay).toBe(false)
    await awake.click()
    await win.getByTestId('awake-display').click()
    await expect.poll(() => JSON.parse(readFileSync(join(f.data, 'workspace.json'), 'utf8')).awakeDisplay).toBe(true)

    // While a command runs: armed, on while it runs.
    await awake.click()
    await win.getByTestId('awake-busy').click()
    await expect(awake).toHaveAttribute('data-state', 'armed')
    await win.keyboard.press('Control+Backquote')
    await expect(win.getByTestId('console-panel')).toBeVisible()
    const pane = win.locator('.console-pane').first()
    await expect.poll(async () => (await pane.locator('.dsk-term-row').allTextContents()).join('').trim().length, { timeout: 20_000 }).toBeGreaterThan(0)
    await pane.click()
    await win.keyboard.type(win32 ? 'Start-Sleep 4' : 'sleep 4')
    await win.keyboard.press('Enter')
    await expect(awake).toHaveAttribute('data-state', 'on', { timeout: 10_000 })
    // The console is shown apart in the processes window.
    await gauge.click()
    await expect(dialog.getByTestId('res-row-console')).toBeVisible({ timeout: 10_000 })
    await win.keyboard.press('Escape')
    await awake.click()
    await win.getByTestId('awake-off').click()
    await expect(awake).toHaveAttribute('data-state', 'off')
  } finally {
    await app.close()
  }
})
