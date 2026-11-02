import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('formulas and highlights: drawn in reading and in the visual editor, the Markdown kept as written', async () => {
  const f = fixture()
  const doc = join(f.folder, 'physics.md')
  const text = '# Physics\n\nEnergy $E = mc^2$, ==remember it==; tickets cost $5 or $10.\n\n$$\n\\left( \\sum_{i=1}^{n} \\frac{1}{i} \\right)\n$$\n'
  writeFileSync(doc, text)
  const app = await electron.launch({ args: ['.', doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Physics' })).toBeVisible()

    // Reading: a formula in the line, one on its own line, a highlight; prices stay text.
    await expect(pane.locator('math:not([display])')).toHaveCount(1)
    await expect(pane.locator('math[display="block"]')).toHaveCount(1)
    await expect(pane.locator('mark')).toHaveText('remember it')
    await expect(pane.locator('p', { hasText: 'tickets cost $5 or $10.' })).toBeVisible()
    // The math font is there (folio carries one), so the fences stretch to the fraction.
    expect(await win.evaluate(() => document.fonts.check('16px "STIX Two Math"'))).toBe(true)
    const sizes = await pane.locator('math[display="block"]').evaluate((m) => ({ fence: m.querySelector('mo[fence]')!.getBoundingClientRect().height, frac: m.querySelector('mfrac')!.getBoundingClientRect().height }))
    expect(sizes.fence).toBeGreaterThanOrEqual(sizes.frac * 0.9)

    // The visual editor: each formula one island, drawn; an edit elsewhere keeps the formulas as written.
    await viewMode(win, 'visual')
    const islands = pane.locator('dsk-markdown-editor [contenteditable="true"] span[data-math]')
    await expect(islands).toHaveCount(2)
    await expect(islands.first().locator('math')).toBeVisible()
    await pane.locator('dsk-markdown-editor [contenteditable="true"] h1').click()
    await win.keyboard.press('End')
    await win.keyboard.type('!')
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /physics\.md/ })).not.toHaveClass(/dirty/)
    expect(readFileSync(doc, 'utf8')).toBe(text.replace('# Physics', '# Physics!'))
  } finally {
    await app.close()
  }
})
