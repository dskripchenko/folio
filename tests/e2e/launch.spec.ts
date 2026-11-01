import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the window opens, isolated, and keeps its data where it was told', async () => {
  const data = mkdtempSync(join(tmpdir(), 'folio-data-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('welcome')).toBeVisible()
    expect(await win.title()).toBe('folio')

    // No Node in the page: only the preload's bridge.
    const page = await win.evaluate(() => ({ require: typeof (window as unknown as { require?: unknown }).require, bridge: typeof (window as unknown as { folio?: unknown }).folio }))
    expect(page).toEqual({ require: 'undefined', bridge: 'object' })

    const paths = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }))
    expect(paths.userData).toBe(data)
    expect(paths.sessionData.startsWith(data)).toBe(true)
    expect(existsSync(data)).toBe(true)
  } finally {
    await app.close()
    rmSync(data, { recursive: true, force: true })
  }
})
