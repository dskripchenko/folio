import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('search in files: matches by file and line as they come, scope, options; a click opens the file at the match', async () => {
  const f = fixture()
  const other = join(f.root, 'service')
  mkdirSync(join(other, 'src'), { recursive: true })
  mkdirSync(join(other, 'vendor'), { recursive: true })
  writeFileSync(join(f.folder, 'plan.md'), '# Plan\n\nThe quokka goes out.\n\nAn Quokka again, and quokkas.\n\nLast: the quokka.\n')
  writeFileSync(join(other, 'src', 'billing.ts'), 'export function quokka() {\n  return 1\n}\n// quokka\n')
  writeFileSync(join(other, 'vendor', 'lib.ts'), 'quokka in a dependency\n')
  writeFileSync(join(other, 'image.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 0, 0]), Buffer.from('quokka')]))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    for (const dir of [f.folder, other]) {
      await app.evaluate(({ dialog }, paths) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      }, [dir])
      await win.getByTestId('add-project').click()
      await win.getByTestId('add-folder').click()
    }
    await expect(win.getByTestId('projects').locator('.project')).toHaveCount(2)

    await win.keyboard.press(`${mod}+Shift+f`)
    const panel = win.getByTestId('search-panel')
    await expect(panel).toBeVisible()
    await expect(win.getByTestId('search-input')).toBeFocused()
    await win.getByTestId('search-input').fill('quokka')
    await win.getByTestId('search-input').press('Enter')
    // plan.md: 4 (quokka, Quokka, quokkas, quokka); billing.ts: 2; not the dependency, not the picture.
    await expect(win.getByTestId('search-status')).toHaveText(/^6 (matches|совпадений) (in|в) 2 (files|файлах)$/)
    const files = panel.getByTestId('search-file')
    await expect(files).toHaveCount(2)
    const plan = files.filter({ hasText: 'plan.md' })
    await expect(plan.getByTestId('search-hit')).toHaveCount(4)
    await expect(plan.getByTestId('search-hit').first()).toHaveAttribute('data-line', '3')
    await expect(plan.getByTestId('search-hit').first().locator('b')).toHaveText('quokka')

    // Options: whole word and case.
    await win.getByTestId('search-wholeWord').click()
    await expect(win.getByTestId('search-status')).toHaveText(/^5 /)
    await win.getByTestId('search-caseSensitive').click()
    await expect(win.getByTestId('search-status')).toHaveText(/^4 /)
    await win.getByTestId('search-caseSensitive').click()
    await win.getByTestId('search-wholeWord').click()
    // Scope: one project.
    const scope = win.getByTestId('search-scope')
    await scope.selectOption({ label: 'service' })
    await expect(win.getByTestId('search-status')).toHaveText(/^2 /)
    await scope.selectOption('all')
    await expect(win.getByTestId('search-status')).toHaveText(/^6 /)

    // The fourth match of plan.md: the file opens, the find bar lands on it.
    await plan.getByTestId('search-hit').nth(3).click()
    await expect(win.getByRole('tab', { name: /plan\.md/ })).toHaveAttribute('aria-selected', 'true')
    await expect(win.getByTestId('find-bar')).toBeVisible()
    await expect(win.getByTestId('find-count')).toHaveText(/^4 (of|из) 4$/)
    // In code: the second match of billing.ts, line 4.
    await files.filter({ hasText: 'billing.ts' }).getByTestId('search-hit').nth(1).click()
    await expect(win.getByRole('tab', { name: /billing\.ts/ })).toHaveAttribute('aria-selected', 'true')
    await expect(win.getByTestId('find-count')).toHaveText(/^2 (of|из) 2$/)
    // A long file: opened at the match, not at its top.
    writeFileSync(join(other, 'src', 'long.ts'), '// filler\n'.repeat(300) + 'const quokka = 2\n')
    // The disk tells the index after a moment.
    await expect(async () => {
      await win.getByTestId('search-input').press('Enter')
      await expect(files.filter({ hasText: 'long.ts' })).toHaveCount(1, { timeout: 1000 })
    }).toPass()
    await files.filter({ hasText: 'long.ts' }).getByTestId('search-hit').first().click()
    await expect(win.locator('article.doc:not([hidden]) .code-line[data-n="301"]')).toBeInViewport()

    // A regular expression; one that does not compile.
    await win.getByTestId('search-regex').click()
    await win.getByTestId('search-input').fill('quokka\\(\\)')
    await win.getByTestId('search-input').press('Enter')
    await expect(win.getByTestId('search-status')).toHaveText(/^1 /)
    await win.getByTestId('search-input').fill('quokka(')
    await win.getByTestId('search-input').press('Enter')
    await expect(win.getByTestId('search-status')).toHaveText(/Invalid|Неверное/)
    await win.getByTestId('search-regex').click()
    await win.getByTestId('search-input').press('Escape')
    await expect(panel).toBeHidden()
  } finally {
    await app.close()
  }
})
