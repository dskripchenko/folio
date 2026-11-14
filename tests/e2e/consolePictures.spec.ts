import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test.skip(process.platform === 'win32', 'driven with a POSIX shell')

const front = (win: Page) => win.locator('.console-group:not([hidden]) .console-pane.active, .console-group:not([hidden]) .console-pane:only-child').first()

test('a console shows pictures: a sixel one and a kitty PNG, over their cells', async () => {
  const f = fixture()
  const script = join(f.root, 'show.cjs')
  writeFileSync(
    script,
    `process.stdout.write('\\x1bP0;1q"1;1;16;12#1;2;100;0;0!16~-!16~\\x1b\\\\\\n')
     process.stdout.write('\\x1b_Ga=T,f=100;iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DAwMDAxMDAAAAeBQHDqPLJlQAAAABJRU5ErkJggg==\\x1b\\\\\\n')`,
  )
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await win.keyboard.press('Control+Backquote')
    await expect.poll(async () => (await front(win).locator('.dsk-term-row').allTextContents()).join('').trim().length, { timeout: 20_000 }).toBeGreaterThan(0)
    await win.keyboard.type(`node "${script}"`)
    await win.keyboard.press('Enter')
    const pictures = front(win).locator('.dsk-term-picture')
    await expect(pictures).toHaveCount(2)
    expect(await pictures.evaluateAll((els) => els.map((e) => e.tagName))).toEqual(['CANVAS', 'IMG'])
  } finally {
    await app.close()
  }
})
