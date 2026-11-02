// The app's icons from build/icons/folio.svg (and folio-small.svg for 16 and
// 32 pixels): PNGs at every size, folio.icns (macOS, by iconutil) and
// folio.ico (Windows, by Python's Pillow). Drawn by Chromium, so the pictures
// are the same on any machine. Run on a Mac: `node scripts/icons.mjs`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const dir = join(import.meta.dirname, '..', 'build', 'icons')
const png = join(dir, 'png')
mkdirSync(png, { recursive: true })
const big = readFileSync(join(dir, 'folio.svg'), 'utf8')
const small = readFileSync(join(dir, 'folio-small.svg'), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage()
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${(size <= 32 ? small : big).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await page.screenshot({ path: join(png, `${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}
await browser.close()

// macOS: an iconset folder made into folio.icns.
const set = join(dir, 'folio.iconset')
rmSync(set, { recursive: true, force: true })
mkdirSync(set)
for (const [name, size] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) {
  copyFileSync(join(png, `${size}.png`), join(set, `icon_${name}.png`))
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(dir, 'folio.icns')])
rmSync(set, { recursive: true, force: true })

// Windows: one .ico with the sizes Windows asks for.
execFileSync('python3', ['-c', `
from PIL import Image
sizes = [16, 24, 32, 48, 64, 128, 256]
images = [Image.open('${png}/%d.png' % s) for s in sizes]
images[-1].save('${join(dir, 'folio.ico')}', sizes=[(s, s) for s in sizes], append_images=images[:-1])
`])
console.log('icons written to build/icons')
