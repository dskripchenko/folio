import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('kanban and calendar files: drawn as a board and a calendar, edited on them and saved as markup; a new board from the commands', async () => {
  const f = fixture()
  const board = join(f.folder, 'Release.kanban.md')
  const cal = join(f.folder, 'Duty.calendar.md')
  writeFileSync(board, '# Release\n\n## Backlog\n- Instant payments #payments\n\n## Done {done}\n- Signed webhooks\n')
  writeFileSync(cal, '# Duty\n\n2026-11-03 10:00-11:00 Release demo\n')
  const app = await electron.launch({ args: ['.', board, cal], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    // The calendar (opened last).
    await expect(pane.locator('dsk-calendar')).toBeVisible()
    await expect(pane.locator('dsk-calendar')).toContainText('Release demo')

    // The board: read, then edited — a card added through the element's own source tab is saved as markup.
    await win.getByRole('tab', { name: /Release\.kanban\.md/ }).click()
    const kanban = pane.locator('dsk-kanban')
    await expect(kanban).toContainText('Instant payments')
    await viewMode(win, 'visual')
    const editable = pane.locator('dsk-kanban[editable]')
    await expect(editable).toBeVisible()
    await editable.evaluate((el) => el.dispatchEvent(new CustomEvent('dsk:change', { detail: { source: '# Release\n\n## Backlog\n- Instant payments #payments\n- Partial refunds\n\n## Done {done}\n- Signed webhooks\n' } })))
    await win.keyboard.press(`${mod}+s`)
    await expect.poll(() => readFileSync(board, 'utf8')).toContain('- Partial refunds')

    // A new board from the commands: beside the note in view, opened for editing.
    await win.keyboard.press(`${mod}+k`)
    await win.locator('[data-command="new-kanban"]').click()
    await expect(win.getByRole('tab', { selected: true })).toHaveText(/\.kanban\.md/)
    const made = (await win.getByRole('tab', { selected: true }).getAttribute('title'))!
    expect(existsSync(made)).toBe(true)
    await expect(pane.locator('dsk-kanban[editable]')).toBeVisible()
  } finally {
    await app.close()
  }
})
