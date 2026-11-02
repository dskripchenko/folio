import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

test('the status line: the length of the note, the caret in its source; spelling turned off and on, kept', async () => {
  const f = fixture()
  const doc = join(f.folder, 'short.md')
  writeFileSync(doc, '# Short note\n\nThree more words.\n')
  const app = await electron.launch({ args: ['.', doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const status = win.getByTestId('status')
    await expect(status).toContainText(/^5 (words|слов)/)

    // In the source, where the caret is.
    await viewMode(win, 'source')
    const field = win.locator('article.doc:not([hidden]) textarea.dsk-md__source')
    await field.click()
    await field.evaluate((a: HTMLTextAreaElement) => {
      a.setSelectionRange(16, 16)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await expect(status).toContainText(/(Ln|Стр) 3, (Col|кол) 3/)

    // Typing: the count follows.
    await field.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await win.keyboard.type('And two.')
    await expect(status).toContainText(/^7 (words|слов)/)

    // Spelling: a choice of the settings menu, kept in the workspace.
    const before = await win.evaluate(() => (window as unknown as { folio: { spellcheck(): Promise<boolean> } }).folio.spellcheck())
    await win.getByTestId('rail-settings').click()
    await win.getByTestId('spellcheck').click()
    await expect.poll(() => JSON.parse(readFileSync(join(f.data, 'workspace.json'), 'utf8')).spellcheck).toBe(!before)
  } finally {
    await app.close()
  }
})
