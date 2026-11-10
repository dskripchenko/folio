/**
 * Export as PDF (ADR-001, stage 7): the page settings, asked once and
 * remembered; the main process asks where to save and makes the PDF.
 */
import { folio, prefs } from './bridge'

export interface PdfText {
  title: string
  folderTitle: string
  pageSize: string
  orientation: string
  portrait: string
  landscape: string
  margins: string
  marginNames: readonly string[]
  header: string
  footer: string
  toc: string
  outline: string
  background: string
  export: string
  exporting: string
  cancel: string
  saved: string
  failed: string
}

export type PdfTarget = { kind: 'doc'; path: string | null; text?: string; name?: string } | { kind: 'folder'; dir: string }

interface Options {
  pageSize: string
  landscape: boolean
  margins: { top: number; right: number; bottom: number; left: number }
  header: boolean
  footer: boolean
  toc: boolean
  outline: boolean
  background: boolean
}

const MARGINS = [0, 12, 20, 25] as const
const SIZES = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid']
const DEFAULTS: Options = { pageSize: 'A4', landscape: false, margins: { top: 20, right: 18, bottom: 20, left: 18 }, header: true, footer: true, toc: true, outline: true, background: true }

function select(label: string, values: [string, string][], value: string, testid: string): [HTMLLabelElement, HTMLSelectElement] {
  const l = document.createElement('label')
  l.textContent = label
  const s = document.createElement('select')
  s.dataset.testid = testid
  for (const [v, text] of values) s.append(new Option(text, v, false, v === value))
  l.append(s)
  return [l, s]
}

function check(label: string, on: boolean, testid: string): [HTMLLabelElement, HTMLInputElement] {
  const l = document.createElement('label')
  l.className = 'check'
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.checked = on
  box.dataset.testid = testid
  l.append(box, label)
  return [l, box]
}

/** The dialog; resolves when it is closed (with the result reported through `notify`). */
export function openPdfDialog(t: PdfText, target: PdfTarget, notify: (message: string, kind?: 'success' | 'error') => void): void {
  const saved = { ...DEFAULTS, ...prefs.get<Partial<Options>>('pdfOptions', {}) }
  const dialog = document.createElement('dialog')
  dialog.className = 'pdf-dialog'
  dialog.dataset.testid = 'pdf-dialog'
  const form = document.createElement('form')
  const h = document.createElement('h2')
  h.textContent = target.kind === 'folder' ? t.folderTitle : t.title
  const nearest = MARGINS.reduce((a, b) => (Math.abs(b - saved.margins.top) < Math.abs(a - saved.margins.top) ? b : a))
  const [sizeL, size] = select(t.pageSize, SIZES.map((s) => [s, s]), saved.pageSize, 'pdf-size')
  const [orientL, orient] = select(t.orientation, [['portrait', t.portrait], ['landscape', t.landscape]], saved.landscape ? 'landscape' : 'portrait', 'pdf-orientation')
  const [marginL, margin] = select(t.margins, MARGINS.map((m, i) => [String(m), `${t.marginNames[i]} · ${m} mm`]), String(nearest), 'pdf-margins')
  const [headerL, header] = check(t.header, saved.header, 'pdf-header')
  const [footerL, footer] = check(t.footer, saved.footer, 'pdf-footer')
  const [tocL, toc] = check(t.toc, saved.toc, 'pdf-toc')
  const [outlineL, outline] = check(t.outline, saved.outline, 'pdf-outline')
  const [bgL, bg] = check(t.background, saved.background, 'pdf-background')
  const grid = document.createElement('div')
  grid.className = 'grid'
  grid.append(sizeL, orientL, marginL)
  const checks = document.createElement('div')
  checks.className = 'checks'
  checks.append(headerL, footerL, tocL, outlineL, bgL)
  const buttons = document.createElement('div')
  buttons.className = 'buttons'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = t.cancel
  cancel.addEventListener('click', () => dialog.close())
  const go = document.createElement('button')
  go.type = 'submit'
  go.className = 'primary'
  go.textContent = t.export
  buttons.append(cancel, go)
  form.append(h, grid, checks, buttons)
  dialog.append(form)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const m = Number(margin.value)
    // Sides a little narrower than top and bottom, as on a printed page.
    const options: Options = {
      pageSize: size.value,
      landscape: orient.value === 'landscape',
      margins: { top: m, bottom: m, left: Math.round(m * 0.9), right: Math.round(m * 0.9) },
      header: header.checked,
      footer: footer.checked,
      toc: toc.checked,
      outline: outline.checked,
      background: bg.checked,
    }
    prefs.set('pdfOptions', options)
    go.disabled = true
    go.textContent = t.exporting
    const result = await folio().exportPdf(target, options as unknown as Record<string, unknown>)
    go.disabled = false
    go.textContent = t.export
    if ('canceled' in result) return
    dialog.close()
    notify('saved' in result ? t.saved.replace('{file}', result.saved) : t.failed.replace('{error}', result.error), 'saved' in result ? 'success' : 'error')
  })
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog)
  dialog.showModal()
}
