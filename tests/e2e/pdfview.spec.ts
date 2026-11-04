import { _electron as electron, expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'
import { onePagePdf } from './pdfdoc'

test('a PDF in its tab, in Chromium’s viewer; embedded in a note; nothing but PDFs may be framed', async () => {
  const f = fixture()
  const pdf = join(f.folder, 'doc.pdf')
  writeFileSync(pdf, onePagePdf('Hello from a PDF'))
  writeFileSync(join(f.folder, 'page.html'), '<script>parent.document.title = "pwned"</script>')
  const note = join(f.folder, 'Reading.md')
  writeFileSync(note, '# Reading\n\n![[doc.pdf|400x300]]\n')
  const app = await electron.launch({ args: ['.', pdf, note], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await win.getByRole('tab', { name: /doc\.pdf/ }).click()
    const frame = win.locator('article.doc:not([hidden])').getByTestId('pdf-frame')
    await expect(frame).toBeVisible()
    await expect.poll(() => frame.evaluate((f) => (f as HTMLIFrameElement).contentDocument?.contentType)).toBe('application/pdf')
    // The viewer is Chromium's own (its extension's frame inside).
    await expect.poll(() => win.frames().some((fr) => fr.url().startsWith('chrome-extension://'))).toBe(true)
    await expect(win.getByTestId('status')).toHaveText(/PDF$/)
    const folderUrl = (await frame.getAttribute('src'))!.replace(/[^/]*$/, '').replace('/pdf/', '/r/')

    // In a note: a frame of the size asked.
    await win.getByRole('tab', { name: /Reading\.md/ }).click()
    const embed = win.locator('article.doc:not([hidden]) iframe.embed-pdf')
    await expect(embed).toBeVisible()
    const box = (await embed.boundingBox())!
    expect(box.width).toBeCloseTo(400, 0)
    expect(box.height).toBeCloseTo(300, 0)

    // The window frames nothing else: another file of the folder is refused by the CSP, and the PDF path serves PDFs only.
    const refused = await win.evaluate(async (base) => {
      const violations: string[] = []
      document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective))
      const frame = document.createElement('iframe')
      frame.src = `${base}page.html`
      document.body.append(frame)
      await new Promise((r) => setTimeout(r, 500))
      frame.remove()
      const notPdf = await fetch(`${base.replace('/r/', '/pdf/')}page.html`).then((r) => r.status)
      return { violations, notPdf, title: document.title }
    }, folderUrl)
    expect(refused.violations).toContain('frame-src')
    expect(refused.notPdf).toBe(404)
    expect(refused.title).not.toBe('pwned')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
