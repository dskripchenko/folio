import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/** A PNG of one colour, of any size. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** A WAV of silence, `seconds` long. */
function wav(seconds: number): Buffer {
  const rate = 8000
  const data = Buffer.alloc(rate * seconds * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

test('pictures, video, sound and SVG shown in folio: fitted and zoomed, played, drawn as written; the system’s program on asking', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'big.png'), png(1600, 1200, [200, 40, 40]))
  copyFileSync(join(import.meta.dirname, '..', 'fixtures', 'clip.webm'), join(proj, 'clip.webm'))
  writeFileSync(join(proj, 'beep.wav'), wav(2))
  writeFileSync(join(proj, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3366ff"/></svg>\n')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog, shell }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      const g = globalThis as { opened?: string[] }
      g.opened = []
      shell.openPath = (async (p: string) => (g.opened!.push(p), '')) as typeof shell.openPath
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await project.locator('.project-row').click()
    const status = win.getByTestId('status')
    const pane = win.locator('article.doc:not([hidden])')

    // A picture: in a tab of its own, not the system's program; bigger than the view, so fitted.
    await project.locator('.tree .row', { hasText: 'big.png' }).click()
    await expect(win.getByRole('tab', { name: /big\.png/ })).toHaveAttribute('aria-selected', 'true')
    const img = pane.getByTestId('media-image')
    await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(1600)
    expect(await app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual([])
    await expect(status).toHaveText(/^1600 × 1200 · .+ (KB|КБ) · PNG$/)
    const zoom = pane.getByTestId('image-zoom')
    const percent = async () => Number((await zoom.textContent())!.replace('%', ''))
    await expect.poll(percent).toBeLessThan(100)
    const fitted = await percent()

    // Its own size, larger, fitted again with 0.
    await pane.getByTestId('image-actual').click()
    await expect(zoom).toHaveText('100%')
    expect((await img.boundingBox())!.width).toBeCloseTo(1600, 0)
    await pane.getByTestId('image-zoom-in').click()
    await expect(zoom).toHaveText('125%')
    await pane.getByTestId('image-stage').focus()
    await win.keyboard.press('0')
    await expect.poll(percent).toBe(fitted)
    // Cmd/Ctrl and the wheel zoom about the pointer.
    const stage = (await pane.getByTestId('image-stage').boundingBox())!
    await win.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
    await win.keyboard.down('Control')
    await win.mouse.wheel(0, -200)
    await win.keyboard.up('Control')
    await expect.poll(percent).toBeGreaterThan(fitted)

    // The system's program, on asking.
    await pane.getByTestId('media-external').click()
    await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened!.length)).toBe(1)

    // Changed on disk: drawn again from the new file.
    writeFileSync(join(proj, 'big.png'), png(800, 600, [40, 200, 40]))
    await expect(status).toHaveText(/^800 × 600 · /, { timeout: 10_000 })

    // A video in the player: its size and length.
    await project.locator('.tree .row', { hasText: 'clip.webm' }).click()
    await expect(pane.locator('dsk-video video')).toBeAttached()
    await expect(status).toHaveText(/^64 × 48 · 0:01 · .+ · WEBM$/, { timeout: 10_000 })

    // A sound: its length.
    await project.locator('.tree .row', { hasText: 'beep.wav' }).click()
    await expect(pane.locator('dsk-audio audio')).toBeAttached()
    await expect(status).toHaveText(/^0:02 · .+ (KB|КБ) · WAV$/, { timeout: 10_000 })

    // An SVG: drawn; edited as text beside its picture, which follows what is written.
    await project.locator('.tree .row', { hasText: 'logo.svg' }).click()
    await viewMode(win, 'read')
    await expect.poll(() => pane.getByTestId('media-image').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(120)
    await viewMode(win, 'visual')
    const editor = pane.locator('.source-editor')
    await expect(editor.getByTestId('preview').getByTestId('media-image')).toBeVisible()
    await editor.evaluate((el) => {
      const e = (el as HTMLElement & { folioEditor: { value: string; dispatch(spec: object): void } }).folioEditor
      const at = e.value.indexOf('#3366ff')
      e.dispatch({ changes: { from: at, to: at + 7, insert: '#ff9900' } })
    })
    await expect.poll(() => editor.getByTestId('preview').getByTestId('media-image').getAttribute('src')).toContain(encodeURIComponent('#ff9900'))
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /logo\.svg/ })).not.toHaveClass(/dirty/)
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
