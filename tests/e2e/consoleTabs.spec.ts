import { _electron as electron, expect, test } from '@playwright/test'
import { fixture } from './fixture'

test('console tabs: a colour of their own, a group named, folded and closed; the others and all closed from the menu', async () => {
  const f = fixture()
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await win.keyboard.press('Control+Backquote')
    const panel = win.getByTestId('console-panel')
    await expect(panel).toBeVisible()
    await panel.getByTestId('console-new').click()
    await panel.getByTestId('console-new').click()
    const tabs = panel.getByTestId('console-tab')
    await expect(tabs).toHaveCount(3)
    const visible = () => tabs.evaluateAll((els) => els.filter((el) => el.checkVisibility()).length)

    // A colour from the tab's menu.
    await tabs.nth(0).click({ button: 'right' })
    await win.getByTestId('console-tab-color').click()
    await win.getByTestId('console-color-red').click()
    await expect(tabs.nth(0)).toHaveAttribute('data-color', 'red')

    // A group named in place; another tab joins it and stands beside.
    await tabs.nth(0).click({ button: 'right' })
    await win.getByTestId('console-tab-new-group').click()
    await expect(win.getByTestId('console-tab-group-name')).toBeFocused()
    await win.getByTestId('console-tab-group-name').fill('Work')
    await win.getByTestId('console-tab-group-name').press('Enter')
    const chip = panel.getByTestId('console-tab-group')
    await expect(chip).toHaveText('Work')
    await tabs.nth(2).click({ button: 'right' })
    await win.getByTestId('console-tab-add-to-group').click()
    await win.getByTestId('console-group-choice').click()
    await expect(tabs.nth(1)).toHaveClass(/grouped/)
    await expect(tabs.nth(0)).toHaveClass(/grouped/)
    await expect(tabs.nth(2)).not.toHaveClass(/grouped/)

    // Folded by a click: its tabs hidden, the one outside in front; opened again.
    await tabs.nth(0).click()
    await chip.click()
    await expect.poll(visible).toBe(1)
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
    await chip.click()
    await expect.poll(visible).toBe(3)

    // The group closed from its chip: its consoles gone, the chip too.
    await chip.click({ button: 'right' })
    await win.getByTestId('console-group-close').click()
    await expect(tabs).toHaveCount(1)
    await expect(chip).toHaveCount(0)

    // All closed from a tab's menu: the panel goes.
    await panel.getByTestId('console-new').click()
    await expect(tabs).toHaveCount(2)
    await tabs.nth(0).click({ button: 'right' })
    await win.getByTestId('console-tab-close-all').click()
    await expect(tabs).toHaveCount(0)
    await expect(panel).toBeHidden()
  } finally {
    await app.close()
  }
})
