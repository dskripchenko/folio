import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('a task list edited visually: boxes from the Markdown, one ticked by a click, Enter starts an unticked one, saved as GFM', async () => {
  const f = fixture()
  const note = join(f.folder, 'Plan.md')
  writeFileSync(note, '# Plan\n\n- [x] Cart\n- [ ] Refunds\n')
  const app = await electron.launch({ args: ['.', note], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Plan' })).toBeVisible()
    await win.keyboard.press(`${mod}+e`)
    const items = pane.locator('[contenteditable="true"] li[data-checked]')
    await expect(items).toHaveCount(2)
    // Not a block of Markdown any more.
    await expect(pane.locator('pre code.language-x-markdown')).toHaveCount(0)
    const refunds = items.filter({ hasText: 'Refunds' })
    await refunds.scrollIntoViewIfNeeded()
    const box = (await refunds.boundingBox())!
    await win.mouse.click(box.x - 12, box.y + 10)
    await expect(refunds).toHaveAttribute('data-checked', 'true')
    await refunds.click({ position: { x: box.width - 4, y: box.height / 2 } })
    await win.keyboard.press('End')
    await win.keyboard.press('Enter')
    await win.keyboard.type('Survey')
    await win.keyboard.press(`${mod}+s`)
    await expect.poll(() => readFileSync(note, 'utf8')).toBe('# Plan\n\n- [x] Cart\n- [x] Refunds\n- [ ] Survey\n')
  } finally {
    await app.close()
  }
})
