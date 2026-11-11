import { _electron as electron, expect, test } from '@playwright/test'
import { fixture } from './fixture'

test('tooltips: what a button does shows on hover, from its title or its aria-label', async () => {
  const f = fixture()
  const app = await electron.launch({ args: ['.', f.doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const tip = win.locator('.app-tip')
    // A rail's icon: its title.
    const testid = (await win.locator('.rail-right .icon-button[title]:visible').first().getAttribute('data-testid'))!
    const rail = win.getByTestId(testid)
    const title = (await rail.getAttribute('title'))!
    await rail.hover()
    await expect(tip).toBeVisible()
    await expect(tip).toHaveText(title)
    // The tab's ×: named only for assistive technology.
    const close = win.locator('.tab .close').first()
    await close.hover()
    await expect(tip).toHaveText((await close.getAttribute('aria-label'))!)
    // An embed's: the calendar's arrow.
    const next = win.locator('article.doc:not([hidden]) .uid-calendar__btn--icon').last()
    await next.scrollIntoViewIfNeeded()
    await next.hover()
    await expect(tip).toHaveText((await next.getAttribute('aria-label'))!)
    // Gone when pressed; the title is back once the pointer leaves.
    await rail.hover()
    await expect(tip).toHaveText(title)
    await win.mouse.down()
    await expect(tip).toBeHidden()
    await win.mouse.up()
    await win.mouse.move(400, 300)
    await expect(rail).toHaveAttribute('title', /./)
  } finally {
    await app.close()
  }
})
