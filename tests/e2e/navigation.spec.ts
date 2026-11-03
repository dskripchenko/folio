import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('code navigation: breadcrumbs, the outline of code, a symbol of the file and of the projects, names completed', async () => {
  const f = fixture()
  const proj = join(f.root, 'shop')
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "shop" }\n')
  writeFileSync(
    join(proj, 'src', 'cart.ts'),
    ['export class Cart {', '  items: number[] = []', '  add(n: number) {', '    this.items.push(n)', '  }', '  total(): number {', '    return this.items.length', '  }', '}', ''].join('\n'),
  )
  writeFileSync(join(proj, 'src', 'prices.ts'), ['export function priceWithTax(p: number) {', '  return p * 1.2', '}', ''].join('\n'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'shop' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'src' }).click()
    await project.locator('.tree .row', { hasText: 'cart.ts' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await viewMode(win, 'visual')
    const editor = doc.locator('.dsk-code-editor')
    const status = win.getByTestId('status')

    // The breadcrumbs: the project, the folders, the file; the symbols holding the caret.
    const crumbs = doc.getByTestId('crumbs')
    await expect(crumbs).toHaveText(/shop.*src.*cart\.ts/)
    await editor.locator('.dsk-code-editor__content').click()
    await win.keyboard.press('Control+g')
    await editor.locator('.dsk-code-editor__panel-input').fill('7')
    await editor.locator('.dsk-code-editor__panel-input').press('Enter')
    await expect(crumbs.getByTestId('crumb')).toHaveText(['Cart', 'total'])

    // The outline: the file's symbols, the one with the caret marked; a click goes there.
    await win.getByTestId('toggle-outline').click()
    const outline = win.getByTestId('outline-panel')
    await expect(outline.getByTestId('outline-item')).toHaveText(['CCart', 'Pitems', 'Madd', 'Mtotal'])
    await expect(outline.locator('.outline-item.on')).toHaveText('Mtotal')
    await outline.getByTestId('outline-item').nth(2).click()
    await expect(status).toHaveText(/^(Ln|Стр) 3, (Col|кол) 3/)

    // Cmd/Ctrl+Shift+O: a symbol of the file by name.
    await editor.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+Shift+O`)
    await win.getByTestId('go-to-symbol-input').fill('tot')
    await expect(win.getByTestId('go-to-symbol-item').first()).toContainText('total')
    await win.getByTestId('go-to-symbol-input').press('Enter')
    await expect(status).toHaveText(/^(Ln|Стр) 6, (Col|кол) 3/)

    // Cmd/Ctrl+Alt+O: a symbol of the projects, its file opened in the editor at it.
    await win.keyboard.press(`${mod}+Alt+O`)
    await win.getByTestId('go-to-symbol-input').fill('pricewt')
    await expect(win.getByTestId('go-to-symbol-item').first()).toContainText('src/prices.ts')
    await win.getByTestId('go-to-symbol-input').press('Enter')
    await expect(win.getByRole('tab', { name: /prices\.ts/ })).toHaveAttribute('aria-selected', 'true')
    await expect(status).toHaveText(/^(Ln|Стр) 1, (Col|кол) 17/)

    // Completion offers the projects' names: Cart from another file.
    const priceEditor = doc.locator('.dsk-code-editor')
    await priceEditor.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+End`)
    await win.keyboard.type('new Ca')
    await expect(priceEditor.locator('.dsk-code-editor__completion-label').first()).toHaveText('Cart')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
