import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

/** A picture as the clipboard or a drag gives it, delivered to an element. */
function deliver(win: Page, selector: string, kind: 'paste' | 'drop', name: string): Promise<void> {
  return win.evaluate(
    ([selector, kind, name, png]) => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], name, { type: 'image/png' }))
      const target = document.querySelector(selector)!
      const r = target.getBoundingClientRect()
      const at = { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }
      if (kind === 'paste') target.dispatchEvent(new ClipboardEvent('paste', { ...at, clipboardData: dt }))
      else {
        target.dispatchEvent(new DragEvent('dragover', { ...at, dataTransfer: dt }))
        target.dispatchEvent(new DragEvent('drop', { ...at, dataTransfer: dt }))
      }
    },
    [selector, kind, name, PNG] as const,
  )
}

test('pictures pasted or dropped into a note: saved in attachments/ beside it, linked, shown', async () => {
  const f = fixture()
  const doc = join(f.folder, 'Trip.md')
  writeFileSync(doc, '# Trip\n\nThe route.\n')
  const app = await electron.launch({ args: ['.', doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Trip' })).toBeVisible()

    // Pasted into the source: a nameless screenshot is named by the time.
    await viewMode(win, 'source')
    const source = pane.locator('textarea.dsk-md__source')
    await source.click()
    await source.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await deliver(win, 'article.doc:not([hidden]) textarea.dsk-md__source', 'paste', 'image.png')
    await expect.poll(() => source.inputValue()).toMatch(/!\[\]\(attachments\/Pasted%20image%20\d{14}\.png\)/)
    const pasted = /attachments\/(Pasted%20image%20\d{14}\.png)/.exec(await source.inputValue())![1]!
    expect(existsSync(join(f.folder, 'attachments', decodeURIComponent(pasted)))).toBe(true)

    // Dropped on the visual editor, by its own name; shown there.
    await viewMode(win, 'visual')
    await deliver(win, 'article.doc:not([hidden]) dsk-markdown-editor [contenteditable="true"] p', 'drop', 'Route map.png')
    await expect(pane.locator('dsk-markdown-editor [contenteditable] img[src$="Route%20map.png"]')).toBeVisible()
    expect(existsSync(join(f.folder, 'attachments', 'Route map.png'))).toBe(true)
    await expect(win.locator('.view.dropping')).toHaveCount(0)

    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /Trip\.md/ })).not.toHaveClass(/dirty/)
    const saved = readFileSync(doc, 'utf8')
    expect(saved).toContain('![Route map](attachments/Route%20map.png)')
    expect(saved).toContain(`![](attachments/${pasted})`)
  } finally {
    await app.close()
  }
})
