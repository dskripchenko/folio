import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { fixture, type Fixture } from './fixture'

async function launch(f: Fixture, ...files: string[]): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({ args: ['.', ...files], env: { ...process.env, FOLIO_DATA: f.data } })
  const win = await app.firstWindow()
  return { app, win }
}

/** The active document's pane. */
const pane = (win: Page) => win.locator('article.doc:not([hidden])')

test('a Markdown file opens offline with every block live and its files by relative path', async () => {
  const f = fixture()
  const { app, win } = await launch(f, f.doc)
  try {
    const doc = pane(win)
    await expect(win.getByRole('tab', { name: /everything\.md/ })).toHaveAttribute('aria-selected', 'true')
    await expect(doc.locator('h1', { hasText: 'Everything' })).toBeVisible()
    // Diagrams of three notations, the API reference, BPMN, draw.io, the kanban and the calendar.
    await expect(doc.locator('svg.dg')).toHaveCount(3, { timeout: 30_000 })
    await expect(doc.locator('.oa-bk', { hasText: 'List orders' })).toBeVisible({ timeout: 30_000 })
    await expect(doc.getByText('Order events').first()).toBeVisible({ timeout: 30_000 })
    await expect(doc.getByRole('img', { name: 'Order handling' })).toBeVisible({ timeout: 30_000 })
    await expect(doc.getByRole('img', { name: 'Architecture' })).toBeVisible({ timeout: 30_000 })
    // No block is left as code or as a "cannot read" notice.
    await expect(doc.locator('.uid-markdown__block-error, .oa-bk__error, .dsk-error')).toHaveCount(0)
    await expect(doc.locator('.uid-board__card', { hasText: 'Ship it' })).toBeVisible()
    await expect(doc.locator('.uid-calendar').first()).toBeVisible()

    // The picture loaded from the document's folder; the video's path resolved there too.
    const img = doc.locator('img[alt="red"]')
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(4)
    const video = await doc.locator('.uid-video video').evaluate((el: HTMLVideoElement) => el.querySelector('source')?.getAttribute('src') ?? el.getAttribute('src'))
    expect(video).toMatch(/^folio:\/\/app\/r\/[0-9a-f]{16}\/media\/clip\.webm$/)

    // Nothing outside the folder: by `..`, encoded or not.
    const base = await doc.locator('dsk-markdown').getAttribute('image-base')
    const outside = await win.evaluate(async (b) => Promise.all([`${b}../secret.txt`, `${b}%2e%2e/secret.txt`, `${b}..%2fsecret.txt`].map((u) => fetch(u).then((r) => r.status, () => 0))), base)
    expect(outside.every((s) => s !== 200)).toBe(true)
    expect(await win.evaluate(async (b) => (await fetch(`${b}other.md`)).status, base)).toBe(200)

    // A link to another document opens it in a tab of its own.
    await doc.locator('a', { hasText: 'link to the other document' }).click({ noWaitAfter: true })
    await expect(win.getByRole('tab', { name: /other\.md/ })).toHaveAttribute('aria-selected', 'true')
    await expect(pane(win).locator('h1', { hasText: 'Other' })).toBeVisible()
  } finally {
    await app.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('the web is reached only after consent, and the session comes back after a restart', async () => {
  let hits = 0
  const server: Server = createServer((_req, res) => {
    hits++
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const f = fixture(`http://127.0.0.1:${port}/picture.png`)
  try {
    const first = await launch(f, f.doc)
    const banner = first.win.getByTestId('net-banner')
    await expect(banner).toBeVisible({ timeout: 30_000 })
    await expect(banner).toContainText(`127.0.0.1:${port}`)
    expect(hits).toBe(0)

    await banner.getByRole('button', { name: /file|файла/ }).click()
    await expect(banner).toBeHidden()
    await expect.poll(() => hits, { timeout: 15_000 }).toBeGreaterThan(0)
    await first.app.close()

    // No file given: what was open comes back, and the consent is remembered.
    hits = 0
    const second = await launch(f)
    await expect(second.win.getByRole('tab', { name: /everything\.md/ })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => hits, { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(second.win.getByTestId('net-banner')).toBeHidden()
    await second.app.close()
  } finally {
    server.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})
