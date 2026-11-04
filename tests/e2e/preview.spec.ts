import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('a note previewed while the pointer rests on a link to it: at its heading; leaving closes it, a click opens it', async () => {
  const f = fixture()
  const dir = join(f.folder, 'vault')
  mkdirSync(join(dir, 'notes'), { recursive: true })
  const index = join(dir, 'Index.md')
  writeFileSync(index, '# Index\n\nSee [[Plan#Goals|the goals]], [the plan](notes/Plan.md) and [[Nowhere]].\n')
  writeFileSync(join(dir, 'notes', 'Plan.md'), `# Plan\n\n${'Filler.\n\n'.repeat(40)}## Goals\n\nShip the preview.\n\n${'More.\n\n'.repeat(40)}`)
  const app = await electron.launch({ args: ['.', index], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Index' })).toBeVisible()
    const preview = win.getByTestId('hover-preview')
    // A rest on a link until the preview shows: a page still settling may move the link from under the pointer.
    const restOn = (link: ReturnType<typeof pane.locator>) =>
      expect(async () => {
        await pane.locator('h1').first().hover()
        await link.hover()
        // The wait (half a second) and the note read: a slow machine takes longer.
        await expect(preview).toBeVisible({ timeout: 4000 })
      }).toPass({ timeout: 15000 })

    // A rest on the [[link]]: the note, at the heading it names.
    await restOn(pane.locator('a[data-wikilink="Plan#Goals"]'))
    const goals = preview.locator('h2', { hasText: 'Goals' })
    await expect(goals).toBeVisible()
    await expect.poll(async () => {
      const [p, g] = await Promise.all([preview.boundingBox(), goals.boundingBox()])
      return g && p ? g.y - p.y : -1
    }).toBeLessThan(120)

    // Away from the link and the preview: it goes.
    await pane.locator('h1').hover()
    await expect(preview).toBeHidden()

    // A Markdown link to a note too; into the preview it stays, a click there opens the note.
    // The pointer moved by hand from the link into the preview (Playwright's hover may move it again while it checks its target),
    // resting on the way, between the link and the panel, longer than a leave takes: it stays. Tried again whole when the
    // system's own cursor moves in meanwhile (another test's window opening under it sends the window a move of its own).
    const planLink = pane.locator('a', { hasText: 'the plan' })
    let box = { x: 0, y: 0, width: 0, height: 0 }
    await expect(async () => {
      await restOn(planLink)
      await expect(preview.locator('h1', { hasText: 'Plan' })).toBeVisible()
      const linkBox = (await planLink.boundingBox())!
      box = (await preview.boundingBox())!
      const gapY = linkBox.y + linkBox.height < box.y ? (linkBox.y + linkBox.height + box.y) / 2 : (box.y + box.height + linkBox.y) / 2
      await win.mouse.move(linkBox.x + linkBox.width / 2, gapY, { steps: 2 })
      await win.waitForTimeout(700)
      await expect(preview).toBeVisible({ timeout: 100 })
    }).toPass({ timeout: 30_000 })
    await win.mouse.move(box.x + 40, box.y + 30, { steps: 4 })
    await win.waitForTimeout(400)
    await expect(preview).toBeVisible()
    await preview.click()
    await expect(win.getByRole('tab', { name: /Plan\.md/ })).toHaveAttribute('aria-selected', 'true')
    await expect(preview).toBeHidden()

    // A link to no note: no preview.
    await win.getByRole('tab', { name: /Index\.md/ }).click()
    await pane.locator('a[data-wikilink="Nowhere"]').hover()
    await win.waitForTimeout(900)
    await expect(preview).toBeHidden()

    // A small window: the preview shorter, never over its link.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(640, 480))
    const link = pane.locator('a[data-wikilink="Plan#Goals"]')
    // Measured while it shows (the system's own cursor may close it meanwhile): tried again whole.
    await expect(async () => {
      await restOn(link)
      const [l, p] = await Promise.all([link.boundingBox(), preview.boundingBox()])
      expect(l && p).toBeTruthy()
      expect(p!.y >= l!.y + l!.height || p!.y + p!.height <= l!.y).toBe(true)
    }).toPass({ timeout: 30_000 })
  } finally {
    await app.close()
  }
})
