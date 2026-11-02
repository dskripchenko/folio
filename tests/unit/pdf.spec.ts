import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PDF, folderDocuments, pdfName, pdfOptions, printToPdfOptions, SLIDES_PDF } from '../../src/main/pdf'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-pdf-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('PDF options', () => {
  it('takes what is valid, falls back for the rest', () => {
    expect(pdfOptions(undefined)).toEqual(DEFAULT_PDF)
    const o = pdfOptions({ pageSize: 'Letter', landscape: true, margins: { top: 5, left: 200, right: 'x' }, toc: false, header: 'yes' })
    expect(o.pageSize).toBe('Letter')
    expect(o.landscape).toBe(true)
    expect(o.margins).toEqual({ top: 5, right: DEFAULT_PDF.margins.right, bottom: DEFAULT_PDF.margins.bottom, left: 60 })
    expect(o.toc).toBe(false)
    expect(o.header).toBe(DEFAULT_PDF.header)
    expect(pdfOptions({ pageSize: 'B9' }).pageSize).toBe('A4')
  })

  it("becomes Chromium's options: inches, room for the header and footer, escaped title, bookmarks", () => {
    const p = printToPdfOptions({ ...DEFAULT_PDF, margins: { top: 5, right: 25.4, bottom: 0, left: 12.7 } }, 'Notes <&> "x"')
    expect(p.margins).toEqual({ top: 0.472, right: 1, bottom: 0.472, left: 0.5 })
    expect(p.displayHeaderFooter).toBe(true)
    expect(p.headerTemplate).toContain('Notes &lt;&amp;&gt; &quot;x&quot;')
    expect(p.footerTemplate).toContain('class="pageNumber"')
    expect(p.footerTemplate).toContain('class="totalPages"')
    expect(p.generateDocumentOutline).toBe(true)
    const bare = printToPdfOptions({ ...DEFAULT_PDF, header: false, footer: false, outline: false, margins: { top: 0, right: 0, bottom: 0, left: 0 } }, 'x')
    expect(bare.displayHeaderFooter).toBe(false)
    expect(bare.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(bare.generateDocumentOutline).toBe(false)
  })

  it('slides: 16:9 pages, edge to edge, no header or footer', () => {
    const p = printToPdfOptions(SLIDES_PDF, 'Talk')
    expect(p.pageSize).toEqual({ width: 13.333, height: 7.5 })
    expect(p.landscape).toBe(false)
    expect(p.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(p.displayHeaderFooter).toBe(false)
  })

  it("names the PDF after the document or the folder", () => {
    expect(pdfName('/a/notes.md')).toBe('notes.pdf')
    expect(pdfName('/a/handbook')).toBe('handbook.pdf')
  })
})

describe('a folder as one PDF', () => {
  it('in the order of a book: index first, documents by name, then subfolders; tooling and other files left out', () => {
    const files = ['README.md', '10-later.md', '2-first.md', 'diagram.bpmn', 'notes.txt', 'photo.png', 'guides/index.md', 'guides/b.md', 'guides/a.mmd', 'node_modules/x/readme.md', '.hidden/y.md', 'zeta/z.md']
    for (const f of files) {
      mkdirSync(join(dir, f, '..'), { recursive: true })
      writeFileSync(join(dir, f), '# x\n')
    }
    expect(folderDocuments(dir).map((p) => relative(dir, p).split('\\').join('/'))).toEqual([
      'README.md',
      '2-first.md',
      '10-later.md',
      'diagram.bpmn',
      'guides/index.md',
      'guides/a.mmd',
      'guides/b.md',
      'zeta/z.md',
    ])
  })
})
