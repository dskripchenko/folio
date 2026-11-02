import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

test('aliases: a link by a note’s other name reaches it, and [[ offers the alias', async () => {
  const f = fixture()
  const dir = join(f.folder, 'vault')
  mkdirSync(join(dir, 'notes'), { recursive: true })
  const index = join(dir, 'Index.md')
  writeFileSync(index, '# Index\n\nSee [[Road map]].\n')
  writeFileSync(join(dir, 'notes', 'Roadmap.md'), '---\naliases: [Road map, Big plan]\n---\n\n# Roadmap\n')
  const app = await electron.launch({ args: ['.', index], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    const link = pane.locator('a[data-wikilink="Road map"]')
    await expect(link).toBeVisible()
    await expect(link).not.toHaveClass(/is-missing/)
    await link.click()
    await expect(win.getByRole('tab', { name: /Roadmap\.md/ })).toHaveAttribute('aria-selected', 'true')

    // The alias offered after [[: chosen, the link names the note and shows the alias.
    await win.getByRole('tab', { name: /Index\.md/ }).click()
    await viewMode(win, 'source')
    const source = pane.locator('textarea.dsk-md__source')
    await source.click()
    await source.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await win.keyboard.type('\n[[big')
    await expect(win.locator('.dsk-md__suggest')).toContainText('Big plan')
    await win.keyboard.press('Enter')
    await expect.poll(() => source.inputValue()).toMatch(/\[\[Roadmap\|Big plan\]\]\s*$/)
  } finally {
    await app.close()
  }
})
