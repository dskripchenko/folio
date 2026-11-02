import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const pad = (n: number) => String(n).padStart(2, '0')

test('daily notes and templates: today made from its template, the days around it, a template inserted and a note made from one', async () => {
  const f = fixture()
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    const folders = await win.evaluate(() => (window as unknown as { folio: { folders(): Promise<{ daily: string; templates: string }> } }).folio.folders())
    mkdirSync(folders.templates, { recursive: true })
    writeFileSync(join(folders.templates, 'Daily.md'), '# {{title}}\n\nPlan for {{date:DD.MM.YYYY}}.\n')
    writeFileSync(join(folders.templates, 'Meeting.md'), '## Meeting {{date}}\n\nAttendees:\n')
    mkdirSync(folders.daily, { recursive: true })
    writeFileSync(join(folders.daily, '2020-01-01.md'), '# Long ago\n')

    // Today's note: made from the Daily template, opened.
    const now = new Date()
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    await win.keyboard.press(`${mod}+Shift+d`)
    const pane = win.locator('article.doc:not([hidden])')
    await expect(win.getByRole('tab', { name: new RegExp(`${today}\\.md`) })).toHaveAttribute('aria-selected', 'true')
    expect(readFileSync(join(folders.daily, `${today}.md`), 'utf8')).toBe(`# ${today}\n\nPlan for ${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}.\n`)
    await expect(pane.locator('h1')).toHaveText(today)

    // The daily note before: the nearest one there is.
    await win.keyboard.press(`${mod}+k`)
    await win.locator('[data-command="daily-prev"]').click()
    await expect(win.getByRole('tab', { name: /2020-01-01\.md/ })).toHaveAttribute('aria-selected', 'true')
    // And after it: today's again.
    await win.keyboard.press(`${mod}+k`)
    await win.locator('[data-command="daily-next"]').click()
    await expect(win.getByRole('tab', { name: new RegExp(`${today}\\.md`) })).toHaveAttribute('aria-selected', 'true')

    // A template inserted into the note, at the caret (read mode switches to editing).
    await win.keyboard.press(`${mod}+k`)
    await win.locator('[data-command="template-insert"]').click()
    await win.locator('[data-command$="Meeting.md"]').click()
    const editor = pane.locator('dsk-markdown-editor [contenteditable="true"]')
    await expect(editor.locator('h2', { hasText: `Meeting ${today}` })).toBeVisible()

    // A new note from a template: a quick note with its text, not a file yet.
    await win.keyboard.press(`${mod}+k`)
    await win.locator('[data-command="template-new"]').click()
    await win.locator('[data-command$="Meeting.md"]').click()
    const fresh = win.locator('article.doc:not([hidden]) dsk-markdown-editor [contenteditable="true"]')
    await expect(fresh.locator('h2', { hasText: `Meeting ${today}` })).toBeVisible()
    await expect(win.getByRole('tab', { selected: true })).toHaveClass(/dirty|note/)
    expect(existsSync(join(folders.templates, 'Meeting.md'))).toBe(true)
  } finally {
    await app.close()
  }
})
