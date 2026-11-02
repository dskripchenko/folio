import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('a whiteboard file: drawn as a board, drawn on and saved as its JSON; a new one from the commands', async () => {
  const f = fixture()
  const file = join(f.folder, 'Plan.board')
  const sticky = { id: 'a1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 'a0', color: 'yellow', text: 'Ship on Friday' }
  writeFileSync(file, `${JSON.stringify({ version: 1, objects: { a1: sticky } }, null, 2)}\n`)
  const app = await electron.launch({ args: ['.', file], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    const board = pane.locator('dsk-board')
    await expect(board).toBeVisible()
    await expect(board).toContainText('Friday')
    await expect(board).not.toHaveAttribute('editable')

    // Drawn on: the change is the board's JSON, saved as written by hand.
    await viewMode(win, 'visual')
    const editable = pane.locator('dsk-board[editable]')
    await expect(editable).toBeVisible()
    await expect(win.getByRole('tab', { selected: true })).not.toHaveClass(/dirty/)
    const note = { id: 'b2', type: 'sticky', x: 260, y: 0, w: 200, h: 200, z: 'a1', color: 'pink', text: 'Write the notes' }
    await editable.evaluate((el, objects) => el.dispatchEvent(new CustomEvent('dsk:change', { detail: { board: { version: 1, objects }, ops: [], origin: 'local' } })), { a1: sticky, b2: note })
    await win.keyboard.press(`${mod}+s`)
    await expect.poll(() => readFileSync(file, 'utf8')).toContain('"text": "Write the notes"')
    expect(JSON.parse(readFileSync(file, 'utf8')).objects.b2.color).toBe('pink')

    // A new one from the commands: beside the file in view, opened to draw on.
    await win.keyboard.press(`${mod}+k`)
    await win.locator('[data-command="new-canvas"]').click()
    await expect(win.getByRole('tab', { selected: true })).toHaveText(/\.board/)
    const made = (await win.getByRole('tab', { selected: true }).getAttribute('title'))!
    expect(existsSync(made)).toBe(true)
    expect(JSON.parse(readFileSync(made, 'utf8'))).toEqual({ version: 1, objects: {} })
    await expect(pane.locator('dsk-board[editable]')).toBeVisible()
  } finally {
    await app.close()
  }
})
