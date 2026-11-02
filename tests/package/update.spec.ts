import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'

/**
 * The packaged program updates itself (ADR-001, stage 8): offered a later
 * version — its own archive, served here under the name of 99.0.0 with its
 * checksum — it downloads and checks it, and when it closes the program in
 * its folder is replaced (a marker left inside the old one is gone), with
 * `folio-data/` beside it untouched.
 *
 * FOLIO_APP — the executable; FOLIO_ARCHIVE — the archive it was unpacked
 * from (on Linux the AppImage itself, also APPIMAGE_FILE: the copy that runs).
 */
const app = process.env.FOLIO_APP
const archive = process.env.FOLIO_ARCHIVE
test.skip(!app || !archive, 'FOLIO_APP and FOLIO_ARCHIVE name the packaged program and its archive')

const system = process.platform === 'darwin' ? `mac-${process.arch}.zip` : process.platform === 'win32' ? 'win-x64.zip' : 'linux-x64.AppImage'

/** Where the program is, and a way to tell the old one from its replacement. */
function installed(): { place: string; mark: () => void; replaced: () => boolean; data: string } {
  // On Linux the AppImage, on macOS the bundle (macOS does not let another program write inside it): a new file or folder there.
  if (process.platform !== 'win32') {
    const place = process.platform === 'linux' ? process.env.APPIMAGE_FILE! : /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(app!)![1]!
    const inode = statSync(place).ino
    return { place, mark: () => undefined, replaced: () => existsSync(place) && statSync(place).ino !== inode, data: join(dirname(place), 'folio-data') }
  }
  // On Windows the folder stays and its files are copied over: a file the new version does not have goes.
  const place = dirname(app!)
  const marker = join(place, 'old-version')
  return { place, mark: () => writeFileSync(marker, 'old'), replaced: () => !existsSync(marker) && existsSync(app!), data: join(place, 'folio-data') }
}

test('a later version downloaded, checked and put in the program’s place when it closes', async () => {
  const bytes = readFileSync(archive!)
  const name = `folio-99.0.0-${system}`
  const sha = createHash('sha256').update(bytes).digest('hex')
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    if (req.url === '/releases') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ tag_name: 'v99.0.0', assets: [name, `${name}.sha256`].map((n) => ({ name: n, browser_download_url: `${base}/${n}` })) }))
    } else if (req.url === `/${name}`) res.end(bytes)
    else if (req.url === `/${name}.sha256`) res.end(`${sha}  ${name}\n`)
    else res.writeHead(404).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const target = installed()
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'FOLIO_DATA' && !k.startsWith('npm_') && !k.startsWith('ELECTRON_')) env[k] = v
  env.FOLIO_UPDATE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases`
  if (process.env.APPIMAGE_FILE) env.APPIMAGE = process.env.APPIMAGE_FILE
  try {
    target.mark()
    const electronApp = await electron.launch({ executablePath: app!, env })
    const win = await electronApp.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await win.getByTestId('rail-settings').click()
    await expect(win.getByTestId('update-check')).toContainText(/\(\d+\.\d+\.\d+\)/)
    await win.getByTestId('update-check').click()
    await expect(win.getByTestId('notice')).toContainText('99.0.0', { timeout: 120_000 })
    await expect(win.getByTestId('notice')).not.toContainText(/Downloading|Скачиваем|Looking|Ищем/, { timeout: 120_000 })
    await win.getByTestId('rail-settings').click()
    await expect(win.getByTestId('update-restart')).toContainText('99.0.0')
    await win.keyboard.press('Escape')
    await electronApp.close()
    // Windows copies it over once folio has gone: a moment later.
    await expect.poll(() => target.replaced(), { timeout: 90_000 }).toBe(true)
    expect(existsSync(join(target.data, 'workspace.json')) || existsSync(join(target.data, 'session'))).toBe(true)
  } finally {
    server.close()
  }
})
