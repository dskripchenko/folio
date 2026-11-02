import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('the outline: the note’s headings, a click going to one, the section in view marked, live as it is written', async () => {
  const f = fixture()
  const doc = join(f.folder, 'long.md')
  writeFileSync(doc, `# Guide\n\n${'Text.\n\n'.repeat(30)}## Setup\n\n${'More.\n\n'.repeat(30)}### Details\n\n${'End.\n\n'.repeat(30)}`)
  const app = await electron.launch({ args: ['.', doc], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Guide' })).toBeVisible()
    await win.getByTestId('toggle-outline').click()
    const items = win.getByTestId('outline-panel').getByTestId('outline-item')
    await expect(items).toHaveText(['Guide', 'Setup', 'Details'])

    // A click: the heading at the top of the page, its section marked.
    await items.filter({ hasText: 'Setup' }).click()
    const setup = pane.locator('h2', { hasText: 'Setup' })
    await expect.poll(async () => (await setup.boundingBox())!.y).toBeLessThan(140)
    await expect(items.filter({ hasText: 'Setup' })).toHaveClass(/on/)

    // In the source: the caret on the heading's line; a heading written appears.
    await viewMode(win, 'source')
    const field = pane.locator('textarea.dsk-md__source')
    await items.filter({ hasText: 'Details' }).click()
    await expect.poll(() => field.evaluate((a: HTMLTextAreaElement) => a.value.slice(a.selectionStart, a.selectionStart + 11))).toBe('### Details')
    await field.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await win.keyboard.type('\n## Appendix\n')
    await expect(items).toHaveText(['Guide', 'Setup', 'Details', 'Appendix'])
  } finally {
    await app.close()
  }
})

test('search filters: tag:, path: and file: choose the files; the rest is the text found in them', async () => {
  const f = fixture()
  mkdirSync(join(f.folder, 'work'), { recursive: true })
  writeFileSync(join(f.folder, 'work', 'plan.md'), '# Plan\n\nA deadline here #work/urgent.\n')
  writeFileSync(join(f.folder, 'work', 'notes.md'), '# Notes\n\nA deadline too.\n')
  writeFileSync(join(f.folder, 'home.md'), '# Home\n\nNo deadline, #work though.\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [f.folder])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    await win.keyboard.press(`${mod}+Shift+f`)
    const input = win.getByTestId('search-input')
    const files = win.getByTestId('search-panel').getByTestId('search-file')
    const paths = () => files.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.path).sort())

    await input.fill('deadline path:work')
    await input.press('Enter')
    await expect.poll(paths).toEqual(['work/notes.md', 'work/plan.md'])
    await input.fill('deadline tag:work')
    await input.press('Enter')
    await expect.poll(paths).toEqual(['home.md', 'work/plan.md'])
    await input.fill('tag:work/urgent')
    await input.press('Enter')
    await expect.poll(paths).toEqual(['work/plan.md'])
    await input.fill('file:note')
    await input.press('Enter')
    await expect.poll(paths).toEqual(['work/notes.md'])
  } finally {
    await app.close()
  }
})
