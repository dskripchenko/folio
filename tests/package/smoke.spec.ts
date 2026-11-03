import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fixture } from '../e2e/fixture'

/**
 * The packaged program, unpacked from its archive and started with nothing of
 * the development setup around it (ADR-001, stage 8): every widget drawn
 * offline, a console started (node-pty out of the archive), a PDF saved, and
 * its data kept in `folio-data/` beside the program.
 */
const app = process.env.FOLIO_APP
test.skip(!app, 'FOLIO_APP names the packaged executable')

/** Where the program keeps its data: beside the .app on macOS, the AppImage on Linux, the .exe on Windows. */
function dataBeside(executable: string): string {
  if (process.env.APPIMAGE_FILE) return join(dirname(process.env.APPIMAGE_FILE), 'folio-data')
  const bundle = /^(.*)\/[^/]+\.app\/Contents\/MacOS\/[^/]+$/.exec(executable)
  return join(bundle ? bundle[1]! : dirname(executable), 'folio-data')
}

test('the packaged program: widgets offline, a console, a PDF, its data beside it', async () => {
  const f = fixture()
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'FOLIO_DATA' && !k.startsWith('npm_') && !k.startsWith('ELECTRON_')) env[k] = v
  if (process.env.APPIMAGE_FILE) env.APPIMAGE = process.env.APPIMAGE_FILE
  const electronApp = await electron.launch({ executablePath: app!, args: [f.doc], env })
  try {
    const win = await electronApp.firstWindow()
    expect(await electronApp.evaluate(({ app }) => app.isPackaged)).toBe(true)
    const doc = win.locator('article.doc:not([hidden])')
    // A packaged program's first start is cold (an AppImage unpacked, the fonts read): longer than a test's default wait.
    await expect(doc.locator('h1', { hasText: 'Everything' })).toBeVisible({ timeout: 30_000 })
    await expect(doc.locator('svg.dg')).toHaveCount(3, { timeout: 60_000 })
    await expect(doc.locator('.oa-bk', { hasText: 'List orders' })).toBeVisible({ timeout: 60_000 })
    await expect(doc.getByRole('img', { name: 'Order handling' })).toBeVisible({ timeout: 60_000 })
    await expect(doc.getByRole('img', { name: 'Architecture' })).toBeVisible({ timeout: 60_000 })
    await expect(doc.locator('.uid-board__card', { hasText: 'Ship it' })).toBeVisible()
    await expect(doc.locator('.uid-markdown__block-error, .oa-bk__error, .dsk-error')).toHaveCount(0)
    await expect.poll(() => doc.locator('img[alt="red"]').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(4)

    // A console: node-pty loads from outside the archive and a shell answers.
    await win.keyboard.press('Control+`')
    const term = win.locator('.dsk-term').first()
    await expect(term).toBeVisible({ timeout: 30_000 })
    await term.click()
    // Worked out by the shell, so the typed line itself cannot match: PowerShell on Windows, a POSIX shell elsewhere.
    await win.keyboard.type(process.platform === 'win32' ? 'echo "folio-$(6*7)"\n' : 'echo folio-$((6*7))\n')
    await expect(win.locator('.console-panel')).toContainText('folio-42', { timeout: 30_000 })

    // A PDF — from the page: off a Mac, Ctrl with a letter in a console is the shell's.
    await win.keyboard.press('Control+`')
    await doc.locator('h1', { hasText: 'Everything' }).click()
    const file = join(f.root, 'everything.pdf')
    await electronApp.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
    }, file)
    await win.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+p`)
    await win.getByTestId('pdf-dialog').getByRole('button', { name: /^(Export…|Экспортировать…)$/ }).click()
    await expect(win.getByTestId('notice')).toContainText('everything.pdf', { timeout: 90_000 })
    expect(readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-')
  } finally {
    await electronApp.close()
  }
  expect(existsSync(join(dataBeside(app!), 'workspace.json')) || existsSync(join(dataBeside(app!), 'session'))).toBe(true)
})
