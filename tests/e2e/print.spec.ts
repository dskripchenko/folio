import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('printing: the document alone, every widget in its print form, the widgets back afterwards', async () => {
  const f = fixture()
  const dir = join(f.root, 'print')
  mkdirSync(dir)
  const doc = join(dir, 'report.md')
  writeFileSync(doc, '# Report\n\n```flow\nflowchart LR\n  A[Start] --> B[Finish]\n```\n\n```mermaid\nflowchart LR\n  X --> Y\n```\n')
  const app = await electron.launch({ args: ['.', doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('.dsk-flow-frame svg.fl-svg g.fl-nodes > *').first()).toBeAttached({ timeout: 15_000 })
    // What is on paper at the moment the print dialog opens.
    await win.evaluate(() => {
      const w = window as unknown as { printed: unknown[] }
      w.printed = []
      window.print = () => {
        w.printed.push({
          forms: document.querySelectorAll('article.doc:not([hidden]) .dsk-print-form').length,
          flowWhole: !!document.querySelector('article.doc:not([hidden]) .dsk-print-form > svg'),
          theme: document.documentElement.dataset.theme,
        })
      }
    })
    await win.emulateMedia({ media: 'print' })
    const chrome = await win.evaluate(() => ['.sidebar', '.bar', '.history', '.banner'].map((s) => getComputedStyle(document.querySelector(s)!).display))
    expect(chrome).toEqual(['none', 'none', 'none', 'none'])
    await win.emulateMedia({ media: 'screen' })

    await win.getByTestId('toggle-edit').click()
    await win.keyboard.press(`${mod}+p`)
    await expect.poll(() => win.evaluate(() => (window as unknown as { printed: unknown[] }).printed)).toEqual([{ forms: 1, flowWhole: true, theme: 'light' }])
    // Printed read, not edited; afterwards the widgets again.
    await expect(pane.locator('dsk-markdown-editor')).toHaveCount(0)
    await expect(pane.locator('.dsk-print-form')).toHaveCount(0)
    await expect(pane.locator('.dsk-print-hidden')).toHaveCount(0)
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
