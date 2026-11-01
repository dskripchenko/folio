import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('replace in files: previewed, asked once more, ticked files only, open unsaved ones left out, one commit', async () => {
  const f = fixture()
  const proj = join(f.root, 'zoo')
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'a.md'), '# Wombat\n\nA wombat and a WOMBAT.\n')
  writeFileSync(join(proj, 'src', 'b.ts'), 'const wombat = "wombat"\n')
  writeFileSync(join(proj, 'c.md'), '# Notes\n\nwombat here\n')
  writeFileSync(join(proj, 'd.md'), 'wombat, left as it is\n')
  // A long-pause auto-commit: the replacement's own commit is what shows.
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data, FOLIO_COMMIT_PAUSE: '600000' } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'zoo' })
    await project.locator('.project-row').click()

    // The folder keeps a history.
    await project.locator('.row', { hasText: 'a.md' }).click()
    await win.getByTestId('toggle-history').click()
    const history = win.getByTestId('history')
    await history.getByRole('button', { name: /Keep a history|Вести историю/ }).click()
    await expect(history.getByTestId('branch')).toHaveText('main')

    // c.md open with an unsaved change.
    await project.locator('.row', { hasText: 'c.md' }).click()
    await viewMode(win, 'source')
    const area = win.locator('article.doc:not([hidden]) textarea').first()
    await area.click()
    await win.keyboard.press(`${mod}+End`)
    await win.keyboard.type('\nmy edit')
    await expect(win.getByRole('tab', { name: /c\.md/ })).toHaveClass(/dirty/)

    await win.keyboard.press(`${mod}+Shift+f`)
    const panel = win.getByTestId('search-panel')
    await win.getByTestId('search-input').fill('wombat')
    await win.getByTestId('search-input').press('Enter')
    await expect(win.getByTestId('search-status')).toHaveText(/^7 /)
    await win.getByTestId('search-toggle-replace').click()
    await win.getByTestId('replace-input').fill('quokka')
    // The preview: the match crossed out, what it becomes.
    await expect(panel.locator('.search-preview ins').first()).toHaveText('quokka')
    // d.md not ticked.
    await panel.getByTestId('search-file').filter({ hasText: 'd.md' }).getByTestId('search-include').uncheck()
    const button = win.getByTestId('replace-all')
    await button.click()
    // The first click asks: a.md 3 + b.ts 2 (c.md is open unsaved, d.md not ticked).
    await expect(button).toHaveText(/5 .* 2 /)
    expect(readFileSync(join(proj, 'a.md'), 'utf8')).toContain('wombat')
    await button.click()
    await expect(win.getByTestId('search-status')).toHaveText(/(Replaced|Заменено).*5.*2.*(Committed|Зафиксировано).*1/)
    expect(readFileSync(join(proj, 'a.md'), 'utf8')).toBe('# quokka\n\nA quokka and a quokka.\n')
    expect(readFileSync(join(proj, 'src', 'b.ts'), 'utf8')).toBe('const quokka = "quokka"\n')
    expect(readFileSync(join(proj, 'c.md'), 'utf8')).toBe('# Notes\n\nwombat here\n')
    expect(readFileSync(join(proj, 'd.md'), 'utf8')).toBe('wombat, left as it is\n')
    // Searched again: what is left.
    await expect(panel.getByTestId('search-file')).toHaveCount(2)
    // One commit for the replacement.
    await project.locator('.row', { hasText: 'a.md' }).click()
    await expect(history.getByTestId('versions').locator('.message').first()).toHaveText('Replace "wombat" with "quokka"')
    // The open tab of a.md shows the new text.
    await expect(win.locator('article.doc:not([hidden])')).toContainText('A quokka and a quokka.')

    // A regular expression with a group; `$` is literal without one.
    await win.getByTestId('search-regex').click()
    await win.getByTestId('search-input').fill('const (\\w+)')
    await win.getByTestId('search-input').press('Enter')
    await win.getByTestId('replace-input').fill('let $1')
    await expect(panel.locator('.search-preview ins').first()).toHaveText('let quokka')
    await button.click()
    await button.click()
    await expect(win.getByTestId('search-status')).toHaveText(/(Replaced|Заменено)/)
    expect(readFileSync(join(proj, 'src', 'b.ts'), 'utf8')).toBe('let quokka = "quokka"\n')
    await win.getByTestId('search-regex').click()
    await win.getByTestId('search-input').fill('let')
    await win.getByTestId('search-input').press('Enter')
    await win.getByTestId('replace-input').fill('$1 x')
    await expect(win.getByTestId('search-status')).toHaveText(/^1 /)
    await button.click()
    await button.click()
    await expect(win.getByTestId('search-status')).toHaveText(/(Replaced|Заменено)/)
    expect(readFileSync(join(proj, 'src', 'b.ts'), 'utf8')).toBe('$1 x quokka = "quokka"\n')
  } finally {
    await app.close()
  }
})
