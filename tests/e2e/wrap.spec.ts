import { _electron as electron, expect, test } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

test('long lines: prose wraps, code does not; Alt+Z changes it, remembered for that kind of text', async () => {
  const f = fixture()
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
  const notes = join(f.folder, 'notes.log')
  const other = join(f.folder, 'other.log')
  const code = join(f.folder, 'main.ts')
  writeFileSync(notes, `${long}\n`)
  writeFileSync(other, `${long}\n`)
  writeFileSync(code, `const s = '${long}'\n`)
  const app = await electron.launch({ args: ['.', notes, code, other], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    const breaks = () => pane.locator('.dsk-code-editor__lines > .dsk-code-editor__line').first().locator('br').count()
    const open = async (name: RegExp) => {
      await win.getByRole('tab', { name }).click()
      await viewMode(win, 'visual')
      await expect(pane.locator('.dsk-code-editor__line').first()).toBeVisible()
    }
    await open(/notes\.log/)
    await expect.poll(breaks).toBeGreaterThan(0)
    await open(/main\.ts/)
    await expect.poll(breaks).toBe(0)
    // Alt+Z in the prose: not wrapped — and the other text file is not either, from now on.
    await open(/notes\.log/)
    await pane.locator('.dsk-code-editor__content').click()
    await win.keyboard.press('Alt+z')
    await expect.poll(breaks).toBe(0)
    await open(/other\.log/)
    await expect.poll(breaks).toBe(0)
    // Code is its own: still unwrapped; Alt+Z wraps it.
    await open(/main\.ts/)
    await pane.locator('.dsk-code-editor__content').click()
    await win.keyboard.press('Alt+z')
    await expect.poll(breaks).toBeGreaterThan(0)
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
