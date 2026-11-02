import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('the Markdown source in colour; an edit in the visual mode changes only the edit', async () => {
  const f = fixture()
  const doc = join(f.folder, 'wrapped.md')
  const text = '# Title\n\nA paragraph wrapped\nin the source.\n\n- **One.** An item wrapped in the\n  source, as formatters wrap it.\n- Two\n'
  writeFileSync(doc, text)
  const app = await electron.launch({ args: ['.', doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Title' })).toBeVisible()
    // Reading: the wrapped item is one paragraph, not two.
    await expect(pane.locator('li').first().locator('p')).toHaveCount(0)

    await viewMode(win, 'source')
    const shade = pane.locator('.dsk-md__shade')
    await expect(shade).toBeVisible()
    await expect(shade.locator('.uid-code__tok--heading').first()).toContainText('Title')
    expect(await shade.textContent()).toBe((await pane.locator('textarea.dsk-md__source').inputValue()) + '\n')

    // An edit in the visual mode: the rest of the file is as it was.
    await viewMode(win, 'visual')
    const h1 = pane.locator('dsk-markdown-editor [contenteditable="true"] h1').first()
    await h1.click()
    await win.keyboard.press('End')
    await win.keyboard.type('!')
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /wrapped\.md/ })).not.toHaveClass(/dirty/)
    expect(readFileSync(doc, 'utf8')).toBe(text.replace('# Title', '# Title!'))
  } finally {
    await app.close()
  }
})
