import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test.skip(process.platform === 'win32', 'driven with a POSIX shell')

const front = (win: Page) => win.locator('.console-group:not([hidden]) .console-pane.active, .console-group:not([hidden]) .console-pane:only-child').first()
const text = async (win: Page) => (await front(win).locator('.dsk-term-row').allTextContents()).join('\n')

test('a console and the kitty keyboard protocol: Shift+Enter of its own for a program that asks; flags left behind dropped at the prompt', async () => {
  const f = fixture()
  const keys = join(f.root, 'keys.cjs')
  writeFileSync(
    keys,
    `process.stdin.setRawMode(true); process.stdout.write('\\x1b[>1uready\\r\\n');
     process.stdin.on('data', (d) => { if (d.toString() === 'q') { process.stdout.write('\\x1b[<u'); process.exit(0) } process.stdout.write('got ' + d.toString('hex') + '\\r\\n') })`,
  )
  const crash = join(f.root, 'crash.cjs')
  writeFileSync(crash, "process.stdout.write('\\x1b[>1ugone\\r\\n'); process.exit(1)")
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await win.keyboard.press('Control+Backquote')
    await expect.poll(async () => (await text(win)).trim().length, { timeout: 20_000 }).toBeGreaterThan(0)

    await win.keyboard.type(`node "${keys}"`)
    await win.keyboard.press('Enter')
    await expect.poll(() => text(win)).toContain('ready')
    await win.keyboard.press('Shift+Enter')
    await expect.poll(() => text(win)).toContain('got 1b5b31333b3275')
    await win.keyboard.type('q')

    // A program that ends without taking its flags back: at the next prompt they are gone, Ctrl+C reaches the shell.
    await win.keyboard.type(`node "${crash}"`)
    await win.keyboard.press('Enter')
    await expect.poll(() => text(win)).toContain('gone')
    await win.keyboard.type('sleep 30')
    await win.keyboard.press('Control+c')
    await win.keyboard.type('echo alive-$((1+1))')
    await win.keyboard.press('Enter')
    await expect.poll(() => text(win), { timeout: 10_000 }).toContain('alive-2')
  } finally {
    await app.close()
  }
})
