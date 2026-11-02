import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('the graph of notes: around the note in view or all of it; a node opens its note; the wheel zooms', async () => {
  const f = fixture()
  const proj = join(f.root, 'garden')
  mkdirSync(join(proj, 'notes'), { recursive: true })
  writeFileSync(join(proj, 'Index.md'), '# Index\n\n[[Plan]] and [[Ideas]].\n')
  writeFileSync(join(proj, 'Plan.md'), '# Plan\n\nBack to [Index](Index.md); see [[Tasks]].\n')
  writeFileSync(join(proj, 'notes', 'Ideas.md'), '# Ideas\n')
  writeFileSync(join(proj, 'Tasks.md'), '# Tasks\n\n[[Deep]]\n')
  writeFileSync(join(proj, 'Deep.md'), '# Deep\n')
  writeFileSync(join(proj, 'Alone.md'), '# Alone\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'garden' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'Index.md' }).click()

    await win.getByTestId('toggle-graph').click()
    const panel = win.getByTestId('graph-panel')
    const nodes = panel.getByTestId('graph-node')
    const names = async () => (await nodes.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.name))).sort()

    // Around Index: two links away (Deep is three, Alone none).
    await expect.poll(names).toEqual(['Ideas', 'Index', 'Plan', 'Tasks'])
    await expect(panel.locator('.graph-node.current')).toHaveAttribute('data-name', 'Index')
    await expect(panel.locator('.graph-edges line')).toHaveCount(3)

    // All of the project.
    await panel.getByTestId('graph-all').click()
    await expect.poll(names).toEqual(['Alone', 'Deep', 'Ideas', 'Index', 'Plan', 'Tasks'])
    await expect(panel.locator('.graph-edges line')).toHaveCount(4)

    // The wheel zooms the picture.
    const before = await panel.locator('.graph-svg > g').getAttribute('transform')
    await panel.getByTestId('graph-svg').hover()
    await win.mouse.wheel(0, -300)
    await expect.poll(() => panel.locator('.graph-svg > g').getAttribute('transform')).not.toBe(before)

    // A node opens its note; the graph follows the note in view.
    await nodes.filter({ has: win.locator('text', { hasText: 'Tasks' }) }).locator('circle').click()
    await expect(win.getByRole('tab', { name: /Tasks\.md/ })).toHaveAttribute('aria-selected', 'true')
    await panel.getByTestId('graph-local').click()
    await expect.poll(names).toEqual(['Deep', 'Index', 'Plan', 'Tasks'])
  } finally {
    await app.close()
  }
})
