import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

test('[[links]] between notes: followed by name, missing ones made, suggested after [[, kept on rename', async () => {
  const f = fixture()
  const proj = join(f.root, 'vault')
  mkdirSync(join(proj, 'notes'), { recursive: true })
  writeFileSync(join(proj, 'Index.md'), '# Index\n\nSee [[Plan#Goals|the plan]] and [[Someday]].\n')
  writeFileSync(join(proj, 'notes', 'Plan.md'), `# Plan\n\n${'Filler line.\n\n'.repeat(60)}## Goals\n\n${'Ship it.\n\n'.repeat(60)}`)
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'vault' })
    await project.locator('.project-row').click()
    const root = await project.locator('ul.tree').first().getAttribute('data-root')
    const tree = project.locator('.tree')
    await tree.locator('.row', { hasText: 'Index.md' }).click()

    // Read: a link to a note elsewhere in the project is a link; one to no note is shown missing.
    const pane = win.locator('article.doc:not([hidden])')
    const plan = pane.locator('a[data-wikilink="Plan#Goals"]')
    const someday = pane.locator('a[data-wikilink="Someday"]')
    await expect(plan).toHaveText('the plan')
    await expect(someday).toHaveClass(/is-missing/)
    await expect(plan).not.toHaveClass(/is-missing/)

    // Followed by its name, to its heading.
    await plan.click()
    await expect(win.getByRole('tab', { name: /Plan\.md/ })).toHaveAttribute('aria-selected', 'true')
    const goals = win.locator('article.doc:not([hidden]) h2', { hasText: 'Goals' })
    await expect.poll(async () => (await goals.boundingBox())?.y ?? -1).toBeLessThan(300)

    // A missing note is made beside the linking one and opened.
    await win.getByRole('tab', { name: /Index\.md/ }).click()
    await someday.click()
    await expect(win.getByRole('tab', { name: /Someday\.md/ })).toHaveAttribute('aria-selected', 'true')
    expect(readFileSync(join(proj, 'Someday.md'), 'utf8')).toBe('# Someday\n\n')
    await win.getByRole('tab', { name: /Index\.md/ }).click()
    await expect(someday).not.toHaveClass(/is-missing/)

    // Renamed: the link to it is written anew, the heading and the text kept.
    const menu = (channel: string, value: object) => app.evaluate(({ BrowserWindow }, [c, v]) => BrowserWindow.getAllWindows()[0]!.webContents.send(c as string, v), [channel, value] as const)
    const folder = tree.locator('.row.dir', { hasText: 'notes' })
    if (!(await folder.getAttribute('class'))?.includes('open')) await folder.click()
    await expect(tree.locator('.row', { hasText: 'Plan.md' })).toBeVisible()
    await menu('tree:rename', { root, rel: 'notes/Plan.md' })
    const name = win.getByTestId('tree-name')
    await expect(name).toBeFocused()
    await win.keyboard.type('Roadmap')
    await win.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(proj, 'notes', 'Roadmap.md'))).toBe(true)
    await expect.poll(() => readFileSync(join(proj, 'Index.md'), 'utf8')).toBe('# Index\n\nSee [[Roadmap#Goals|the plan]] and [[Someday]].\n')
    // The open note takes the new text.
    await expect(pane.locator('a[data-wikilink="Roadmap#Goals"]')).toHaveText('the plan')

    // In the source, `[[` suggests the project's notes; a choice writes the link.
    await viewMode(win, 'source')
    const source = pane.locator('textarea.dsk-md__source')
    await source.click()
    await source.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await win.keyboard.type('\n[[road')
    const suggest = win.locator('.dsk-md__suggest')
    await expect(suggest).toContainText('Roadmap')
    await win.keyboard.press('Enter')
    await expect.poll(() => source.inputValue()).toMatch(/\[\[Roadmap\]\]\s*$/)
  } finally {
    await app.close()
  }
})
