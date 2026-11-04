import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('tabs: a colour of their own, groups named, folded and kept across a restart; others, the saved and all closed', async () => {
  const f = fixture()
  const dir = join(f.folder, 'notes')
  mkdirSync(dir, { recursive: true })
  const files = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((n) => {
    const p = join(dir, `${n}.md`)
    writeFileSync(p, `# ${n}\n`)
    return p
  })
  const launch = (args: string[]) => electron.launch({ args: ['.', ...args], env: { ...process.env, FOLIO_DATA: f.data } })
  const names = (win: Awaited<ReturnType<Awaited<ReturnType<typeof launch>>['firstWindow']>>) =>
    win.getByRole('tab').evaluateAll((els) => els.filter((el) => el.checkVisibility()).map((el) => el.querySelector('.label')!.textContent))
  let app = await launch(files)
  try {
    const win = await app.firstWindow()
    const tab = (n: string) => win.getByRole('tab', { name: new RegExp(`${n}\\.md`) })
    await expect(win.getByRole('tab')).toHaveCount(4)

    // A colour of its own, from its menu.
    await tab('Beta').click({ button: 'right' })
    await win.getByTestId('tab-color').click()
    await win.getByTestId('color-red').click()
    await expect(tab('Beta')).toHaveAttribute('data-color', 'red')

    // A new group, named in place; another tab added to it stands beside.
    await tab('Alpha').click({ button: 'right' })
    await win.getByTestId('tab-new-group').click()
    await expect(win.getByTestId('tab-group-name')).toBeFocused()
    await win.getByTestId('tab-group-name').fill('Work')
    await win.getByTestId('tab-group-name').press('Enter')
    const chip = win.getByTestId('tab-group')
    await expect(chip).toHaveText('Work')
    await tab('Gamma').click({ button: 'right' })
    await win.getByTestId('tab-add-to-group').click()
    await win.getByTestId('group-choice').click()
    await expect.poll(() => names(win)).toEqual(['Alpha.md', 'Gamma.md', 'Beta.md', 'Delta.md'])
    await expect(tab('Gamma')).toHaveClass(/grouped/)

    // Its colour changed; folded by a click (the tab in use moves out of it), opened again.
    await chip.click({ button: 'right' })
    await win.getByTestId('group-color').click()
    await win.getByTestId('color-teal').click()
    await tab('Alpha').click()
    await chip.click()
    await expect.poll(() => names(win)).toEqual(['Beta.md', 'Delta.md'])
    await expect(tab('Beta')).toHaveAttribute('aria-selected', 'true')
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
    await chip.click()
    await expect.poll(() => names(win)).toEqual(['Alpha.md', 'Gamma.md', 'Beta.md', 'Delta.md'])
    await chip.click()
  } finally {
    await app.close()
  }

  // Kept across a restart: the colours, the group folded, the order.
  app = await launch([])
  try {
    const win = await app.firstWindow()
    const tab = (n: string) => win.getByRole('tab', { name: new RegExp(`${n}\\.md`) })
    const chip = win.getByTestId('tab-group')
    await expect(chip).toHaveText('Work')
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
    await expect(chip).toHaveAttribute('style', /--tc-teal/)
    await expect(tab('Beta')).toHaveAttribute('data-color', 'red')
    await expect.poll(() => names(win)).toEqual(['Beta.md', 'Delta.md'])
    await chip.click()
    await expect.poll(() => names(win)).toEqual(['Alpha.md', 'Gamma.md', 'Beta.md', 'Delta.md'])

    // A note with changes: closing the others closes the saved ones; a Cancel keeps the note.
    await win.keyboard.press(`${mod}+n`)
    await win.keyboard.type('Draft')
    await expect(win.getByRole('tab').filter({ hasText: 'Draft' })).toHaveClass(/dirty/)
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    await tab('Delta').click({ button: 'right' })
    await win.getByTestId('tab-close-others').click()
    await expect.poll(() => names(win)).toEqual(['Delta.md', 'Draft'])
    await expect(chip).toHaveCount(0)

    // Every tab, with Cmd/Ctrl+Shift+W; the note's changes let go.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    await win.keyboard.press(`${mod}+Shift+w`)
    await expect(win.getByRole('tab')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
