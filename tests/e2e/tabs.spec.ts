import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { copyFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/** A drag by hand, in steps (one jump may never start the browser's drag on a busy machine). */
async function drag(win: Page, from: Locator, x: number, y: number): Promise<void> {
  const a = (await from.boundingBox())!
  await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await win.mouse.down()
  await win.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 4 })
  await win.mouse.move(x, y, { steps: 10 })
  await win.mouse.up()
}

test('tabs: a closed one back at its place; dragged to another place, beside and back', async () => {
  const f = fixture()
  const names = ['A', 'B', 'C']
  const paths = names.map((n) => join(f.folder, `${n}.md`))
  names.forEach((n, i) => writeFileSync(paths[i]!, `# ${n}\n\n${'Text.\n\n'.repeat(60)}`))
  const app = await electron.launch({ args: ['.', ...paths], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const tabs = win.locator('.tabs [role="tab"]')
    const order = async () => (await tabs.allTextContents()).map((s) => s.replace(/[×•\s]/g, '').replace(/\.md$/, ''))
    await expect.poll(order).toEqual(['A', 'B', 'C'])

    // B closed, scrolled down first; Cmd/Ctrl+Shift+T brings it back in the middle, scrolled where it was.
    await win.getByRole('tab', { name: /B\.md/ }).click()
    const view = win.locator('.view').first()
    // Scrolled once its own scroll (restored as it is shown) has settled: the 400 stays.
    await expect
      .poll(async () => {
        await view.evaluate((el) => (el.scrollTop = 400))
        await win.waitForTimeout(100)
        return view.evaluate((el) => el.scrollTop)
      })
      .toBeGreaterThan(300)
    await win.keyboard.press(`${mod}+w`)
    await expect.poll(order).toEqual(['A', 'C'])
    await win.keyboard.press(`${mod}+Shift+t`)
    await expect.poll(order).toEqual(['A', 'B', 'C'])
    await expect(win.getByRole('tab', { name: /B\.md/ })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(300)

    // C dragged before A.
    // (Each drag tried again when the system's own cursor broke it: a drag that did not happen changed nothing.)
    await expect(async () => {
      if ((await order())[0] !== 'C') {
        const a = (await win.getByRole('tab', { name: /A\.md/ }).boundingBox())!
        await drag(win, win.getByRole('tab', { name: /C\.md/ }), a.x + 4, a.y + a.height / 2)
      }
      expect(await order()).toEqual(['C', 'A', 'B'])
    }).toPass({ timeout: 20_000 })

    // A dragged onto the view's right half: beside the main view; dragged to the left half: back.
    const content = (await win.locator('.content').boundingBox())!
    await expect(async () => {
      if (!/two-views/.test((await win.locator('.content').getAttribute('class')) ?? ''))
        await drag(win, win.getByRole('tab', { name: /A\.md/ }), content.x + content.width * 0.8, content.y + content.height / 2)
      await expect(win.locator('.content')).toHaveClass(/two-views/, { timeout: 1000 })
    }).toPass({ timeout: 20_000 })
    await expect(win.locator('.view-beside article.doc:not([hidden]) h1')).toHaveText('A')
    await expect(async () => {
      if (/two-views/.test((await win.locator('.content').getAttribute('class')) ?? ''))
        await drag(win, win.getByRole('tab', { name: /A\.md/ }), content.x + content.width * 0.2, content.y + content.height / 2)
      await expect(win.locator('.content')).not.toHaveClass(/two-views/, { timeout: 1000 })
    }).toPass({ timeout: 20_000 })
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('![[picture]], ![[picture|300]] and ![[video]] embedded in a note; a picture opens in its tab', async () => {
  const f = fixture()
  copyFileSync(join(import.meta.dirname, '..', 'fixtures', 'clip.webm'), join(f.folder, 'clip.webm'))
  const note = join(f.folder, 'Media.md')
  writeFileSync(note, '# Media\n\n![[red.png]]\n\n![[red.png|300]]\n\n![[clip.webm]]\n\n![[Nowhere.png]]\n')
  const app = await electron.launch({ args: ['.', note], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    await expect(pane.locator('h1', { hasText: 'Media' })).toBeVisible()
    const images = pane.locator('img.embed-image')
    await expect(images).toHaveCount(2)
    await expect.poll(() => images.first().evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(4)
    expect((await images.nth(1).boundingBox())!.width).toBeCloseTo(300, 0)
    await expect(pane.locator('dsk-video.embed-media video')).toBeAttached()
    // A missing file stays a link, marked missing.
    await expect(pane.locator('[data-state="missing"]')).toHaveCount(1)
    // A click: the picture in its own tab.
    await images.first().click()
    await expect(win.getByRole('tab', { name: /red\.png/ })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
