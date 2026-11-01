import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

test('code, data and logs: listed in the tree, shown numbered in the colours of their language, edited as text', async () => {
  const f = fixture()
  const proj = join(f.root, 'service')
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'src', 'main.rs'), 'fn main() {\n    let s = "hi"; // greet\n    println!("{}", s);\n}\n')
  writeFileSync(join(proj, 'package.json'), '{\n  "name": "service",\n  "private": true\n}\n')
  writeFileSync(join(proj, 'app.log'), '2026-11-01T10:00:00Z ERROR <b>not markup</b> & more\n2026-11-01T10:00:01Z INFO ok\n')
  writeFileSync(join(proj, 'deploy'), '#!/usr/bin/env bash\necho "$HOME"\n')
  writeFileSync(join(proj, 'image.bin'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(join(proj, 'README.md'), '# Service\n\nSee [main](src/main.rs).\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'service' })
    await project.locator('.project-row').click()
    const tree = project.locator('.tree')
    // Text files with a language are listed (a #! line names it); a binary file is not.
    for (const name of ['src', 'package.json', 'app.log', 'README.md']) await expect(tree.locator('.row', { hasText: name })).toBeVisible()
    await expect(tree.locator('.row', { hasText: 'image.bin' })).toHaveCount(0)

    // A link from a document opens the source in folio.
    await tree.locator('.row', { hasText: 'README.md' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    await doc.getByRole('link', { name: 'main' }).click()
    await expect(win.getByRole('tab', { name: /main\.rs/ })).toHaveAttribute('aria-selected', 'true')
    const view = doc.getByTestId('code-view')
    await expect(view).toHaveAttribute('data-language', 'rust')
    await expect(view.locator('.code-line')).toHaveCount(4)
    await expect(view.locator('.sx-keyword').first()).toHaveText('fn')
    await expect(view.locator('.sx-string').first()).toHaveText('"hi"')
    await expect(view.locator('.sx-comment')).toHaveText('// greet')
    // The numbers are the gutter's, not the text's: a copy holds the code alone.
    expect(await view.locator('pre').evaluate((pre) => pre.textContent)).toBe('fn main() {\n    let s = "hi"; // greet\n    println!("{}", s);\n}')

    // A log: levels; the text is text, never markup.
    await tree.locator('.row', { hasText: 'app.log' }).click()
    await expect(doc.getByTestId('code-view')).toHaveAttribute('data-language', 'log')
    await expect(doc.locator('.sx-error')).toHaveText('ERROR')
    await expect(doc.locator('.sx-info')).toHaveText('INFO')
    await expect(doc.locator('.code-lines b')).toHaveCount(0)
    await expect(doc.locator('.code-line').first()).toContainText('<b>not markup</b> & more')

    // Edited as text, saved; drawn again in colour.
    await tree.locator('.row', { hasText: 'package.json' }).click()
    await expect(doc.locator('.sx-property').first()).toHaveText('"name"')
    await viewMode(win, 'visual')
    const source = doc.getByTestId('source')
    await source.click()
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await win.keyboard.type('\n')
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
    await expect(win.getByRole('tab', { name: /package\.json/ })).not.toHaveClass(/dirty/)
    await viewMode(win, 'read')
    await expect(doc.getByTestId('code-view')).toHaveAttribute('data-language', 'json')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('a data file: errors marked at their lines and stepped through; blocks fold', async () => {
  const f = fixture()
  const proj = join(f.root, 'conf')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'broken.json'), '{\n  "a": {\n    "b": 1,\n    "c": 2\n  },\n  "d": [1, 2,]\n}\n')
  writeFileSync(join(proj, 'ok.yaml'), 'server:\n  host: example.com\n  port: 8080\nlog: info\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'conf' })
    await project.locator('.project-row').click()
    const tree = project.locator('.tree')
    await tree.locator('.row', { hasText: 'broken.json' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    const view = doc.getByTestId('code-view')
    // The error at its line, the message on hover, a count in the head.
    const bad = view.locator('.code-line[data-diagnostic="error"]')
    await expect(bad).toHaveCount(1)
    await expect(bad).toHaveAttribute('data-n', '6')
    await expect(bad).toHaveAttribute('title', /^6:\d+ /)
    await expect(view.getByTestId('code-problems')).toHaveText(/1 (error|ошибка)/)

    // Folding "a": its inner lines hide, the closing one stays; the copy is unchanged.
    const text = await view.locator('pre').evaluate((pre) => pre.textContent)
    expect(text).toBe('{\n  "a": {\n    "b": 1,\n    "c": 2\n  },\n  "d": [1, 2,]\n}')
    await view.getByTestId('fold-2').click()
    await expect(view.locator('.code-line[data-n="3"]')).toBeHidden()
    await expect(view.locator('.code-line[data-n="4"]')).toBeHidden()
    await expect(view.locator('.code-line[data-n="5"]')).toBeVisible()
    // The outer block folds over it; unfolding the outer one leaves the inner folded.
    await view.getByTestId('fold-1').click()
    await expect(view.locator('.code-line[data-n="6"]')).toBeHidden()
    // Stepping to the error unfolds what hides it.
    await view.getByTestId('code-problems').click()
    await expect(view.locator('.code-line[data-n="6"]')).toBeVisible()
    await expect(view.locator('.code-line[data-n="3"]')).toBeHidden()
    await view.getByTestId('fold-2').click()
    await expect(view.locator('.code-line[data-n="3"]')).toBeVisible()

    // A valid file: nothing marked, no count; indentation folds.
    await tree.locator('.row', { hasText: 'ok.yaml' }).click()
    const yaml = doc.getByTestId('code-view')
    await expect(yaml).toHaveAttribute('data-language', 'yaml')
    await expect(yaml.locator('[data-diagnostic]')).toHaveCount(0)
    await expect(yaml.getByTestId('code-problems')).toHaveCount(0)
    await yaml.getByTestId('fold-1').click()
    await expect(yaml.locator('.code-line[data-n="2"]')).toBeHidden()
    await expect(yaml.locator('.code-line[data-n="4"]')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('a big log: only the lines in view are in the page; filtered by level; read at its end it follows what is written', async () => {
  const f = fixture()
  const proj = join(f.root, 'ops')
  mkdirSync(proj, { recursive: true })
  const lines: string[] = []
  for (let i = 0; i < 60_000; i++) {
    const t = `2026-11-01 10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`
    if (i % 1000 === 7) lines.push(`${t} ERROR job ${i} failed`, 'java.lang.IllegalStateException: boom', `    at a.B.c(B.java:${i})`)
    else lines.push(`${t} ${i % 10 === 3 ? 'WARN' : 'INFO'} request ${i} done`)
  }
  const file = join(proj, 'app.log')
  writeFileSync(file, lines.join('\n') + '\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'ops' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'app.log' }).click()
    const doc = win.locator('article.doc:not([hidden])')
    const view = doc.getByTestId('code-view')
    await expect(view).toHaveAttribute('data-language', 'log')
    await expect(view.locator('pre')).toHaveAttribute('data-virtual', '')
    // A window of rows, not 60 120 of them; highlighted.
    await expect(view.locator('.code-line[data-n="1"]')).toBeVisible()
    expect(await view.locator('.code-line').count()).toBeLessThan(400)
    await expect(view.locator('.sx-info').first()).toHaveText('INFO')

    // The end: the last line drawn where it is.
    await win.getByTestId('view').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(view.locator(`.code-line[data-n="${lines.length}"]`)).toBeVisible()

    // Errors only: the entries with their traces.
    await expect(view.getByTestId('level-error')).toHaveText(/60/)
    await view.getByTestId('level-info').click()
    await view.getByTestId('level-warning').click()
    await win.getByTestId('view').evaluate((el) => (el.scrollTop = 0))
    await expect(view.locator('.code-line').first()).toHaveAttribute('data-n', '8')
    await expect(view.locator('.code-line').nth(1)).toContainText('IllegalStateException')
    await expect(view.locator('.code-line').nth(2)).toContainText('at a.B.c')
    await expect(view.locator('.code-line').nth(3)).toContainText('job 1007 failed')

    // Everything again; at the end, a line written to the file comes into view.
    await view.getByTestId('level-info').click()
    await view.getByTestId('level-warning').click()
    await win.getByTestId('view').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(view.locator(`.code-line[data-n="${lines.length}"]`)).toBeVisible()
    writeFileSync(file, lines.join('\n') + '\n2026-11-01 11:00:00 ERROR the newest line\n')
    const fresh = win.locator('article.doc:not([hidden])').getByTestId('code-view').locator(`.code-line[data-n="${lines.length + 1}"]`)
    await expect(fresh).toContainText('the newest line')
    await expect(fresh).toBeInViewport()
    // The filter is kept over the redraw.
    await expect(win.locator('article.doc:not([hidden])').getByTestId('level-error')).toHaveText(/61/)
  } finally {
    await app.close()
  }
})
