import { _electron as electron, expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('documents side by side: one beside the main view, each in use by a click, the divider dragged, back again', async () => {
  const f = fixture()
  const a = join(f.folder, 'alpha.md')
  const b = join(f.folder, 'beta.md')
  const c = join(f.folder, 'gamma.md')
  writeFileSync(a, '# Alpha\n')
  writeFileSync(b, '# Beta\n')
  writeFileSync(c, '# Gamma\n')
  const app = await electron.launch({ args: ['.', a, b, c], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const main = win.getByTestId('view')
    const side = win.getByTestId('view-beside')
    const tab = (name: string) => win.getByRole('tab', { name: new RegExp(`${name}\\.md`) })
    await expect(tab('gamma')).toHaveAttribute('aria-selected', 'true')
    await expect(side).toBeHidden()

    // The tab's menu: beta beside; the main view keeps gamma.
    await tab('beta').click({ button: 'right' })
    await win.getByTestId('tab-beside').click()
    await expect(side).toBeVisible()
    await expect(side.locator('article.doc:not([hidden]) h1')).toHaveText('Beta')
    await expect(main.locator('article.doc:not([hidden]) h1')).toHaveText('Gamma')
    await expect(tab('beta')).toHaveAttribute('aria-selected', 'true')
    await expect(tab('beta')).toHaveClass(/beside/)
    await expect(tab('gamma')).toHaveClass(/shown/)

    // A click in the main view puts its document in use; another tab takes the main view, beta stays beside.
    await main.locator('article.doc:not([hidden]) h1').click()
    await expect(tab('gamma')).toHaveAttribute('aria-selected', 'true')
    await tab('alpha').click()
    await expect(main.locator('article.doc:not([hidden]) h1')).toHaveText('Alpha')
    await expect(side.locator('article.doc:not([hidden]) h1')).toHaveText('Beta')

    // The divider dragged: the main view wider.
    const before = (await main.boundingBox())!.width
    const split = (await win.getByTestId('split').boundingBox())!
    await win.mouse.move(split.x + split.width / 2, split.y + 100)
    await win.mouse.down()
    await win.mouse.move(split.x + 150, split.y + 100, { steps: 5 })
    await win.mouse.up()
    await expect.poll(async () => (await main.boundingBox())!.width).toBeGreaterThan(before + 100)

    // Cmd/Ctrl+\: the side view closed, beta back among the main view's tabs.
    await win.keyboard.press(`${mod}+Backslash`)
    await expect(side).toBeHidden()
    await expect(tab('beta')).not.toHaveClass(/beside/)
    await tab('beta').click()
    await expect(main.locator('article.doc:not([hidden]) h1')).toHaveText('Beta')
    // And again: the active document beside, the main view taking another; closing the one beside closes the view.
    await win.keyboard.press(`${mod}+Backslash`)
    await expect(side.locator('article.doc:not([hidden]) h1')).toHaveText('Beta')
    await expect(main.locator('article.doc:not([hidden]) h1')).not.toHaveText('Beta')
    await tab('beta').locator('.close').click()
    await expect(side).toBeHidden()
    await expect(main.locator('article.doc:not([hidden]) h1')).toBeVisible()
  } finally {
    await app.close()
  }
})
