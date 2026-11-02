import { readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { kindOf, SKIP } from './tree'

/**
 * PDF (ADR-001, stage 7): what the export dialog asks for, how it becomes
 * Chromium's print-to-PDF options, and which documents a folder prints as
 * one PDF. The pages themselves are laid out by the print page
 * (renderer/print.ts) in a hidden window.
 */
export const PAGE_SIZES = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export interface PdfOptions {
  pageSize: PageSize
  landscape: boolean
  /** Millimetres. */
  margins: { top: number; right: number; bottom: number; left: number }
  /** The document's (or folder's) title at the top of each page. */
  header: boolean
  /** Page numbers at the bottom: `3 / 12`. */
  footer: boolean
  /** A table of contents, with links, before the text. */
  toc: boolean
  /** Bookmarks from the headings (the PDF's outline). */
  outline: boolean
  /** Colours and backgrounds of the drawings. */
  background: boolean
  /** A note as slides: one to a 16:9 page, split on its `---` lines. */
  slides?: boolean
}

export const DEFAULT_PDF: PdfOptions = {
  pageSize: 'A4',
  landscape: false,
  margins: { top: 20, right: 18, bottom: 20, left: 18 },
  header: true,
  footer: true,
  toc: true,
  outline: true,
  background: true,
}

/** Slides: 16:9 pages (13.33 × 7.5 in, a presentation's), edge to edge, no lines, no contents. */
export const SLIDES_PDF: PdfOptions = {
  pageSize: 'A4',
  landscape: false,
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  header: false,
  footer: false,
  toc: false,
  outline: true,
  background: true,
  slides: true,
}
const SLIDE_PAGE = { width: 13.333, height: 7.5 }

/** The room a header or footer line needs: less, and Chromium draws it over the text. */
const LINE_ROOM = 12

const mm = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(60, Math.max(0, v)) : fallback)

/** What the window sent, made safe: unknown values fall back to the defaults. */
export function pdfOptions(raw: unknown): PdfOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const m = (o.margins && typeof o.margins === 'object' ? o.margins : {}) as Record<string, unknown>
  const d = DEFAULT_PDF
  const flag = (k: keyof PdfOptions) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (d[k] as boolean))
  return {
    pageSize: PAGE_SIZES.includes(o.pageSize as PageSize) ? (o.pageSize as PageSize) : d.pageSize,
    landscape: flag('landscape'),
    margins: { top: mm(m.top, d.margins.top), right: mm(m.right, d.margins.right), bottom: mm(m.bottom, d.margins.bottom), left: mm(m.left, d.margins.left) },
    header: flag('header'),
    footer: flag('footer'),
    toc: flag('toc'),
    outline: flag('outline'),
    background: flag('background'),
  }
}

const inches = (millimetres: number) => Math.round((millimetres / 25.4) * 1000) / 1000

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The header and footer lines: Chromium fills `title`, `pageNumber` and `totalPages`; they need a font size of their own. */
function line(o: PdfOptions, content: string, align: 'left' | 'center' | 'right'): string {
  return `<div style="width:100%;margin:0 ${o.margins.right}mm 0 ${o.margins.left}mm;font:8px system-ui,-apple-system,'Segoe UI',sans-serif;color:#6b7280;text-align:${align};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${content}</div>`
}

export interface PrintToPdf {
  pageSize: PageSize | { width: number; height: number }
  landscape: boolean
  printBackground: boolean
  margins: { top: number; right: number; bottom: number; left: number }
  displayHeaderFooter: boolean
  headerTemplate: string
  footerTemplate: string
  generateDocumentOutline: boolean
  generateTaggedPDF: boolean
}

/** The options for `webContents.printToPDF`. */
export function printToPdfOptions(o: PdfOptions, title: string): PrintToPdf {
  const top = o.header ? Math.max(o.margins.top, LINE_ROOM) : o.margins.top
  const bottom = o.footer ? Math.max(o.margins.bottom, LINE_ROOM) : o.margins.bottom
  return {
    pageSize: o.slides ? SLIDE_PAGE : o.pageSize,
    landscape: o.slides ? false : o.landscape,
    printBackground: o.background,
    margins: { top: inches(top), right: inches(o.margins.right), bottom: inches(bottom), left: inches(o.margins.left) },
    displayHeaderFooter: o.header || o.footer,
    headerTemplate: o.header ? line(o, `<span>${escape(title)}</span>`, 'left') : '<div></div>',
    footerTemplate: o.footer ? line(o, '<span class="pageNumber"></span> / <span class="totalPages"></span>', 'right') : '<div></div>',
    // Bookmarks come from the headings of a tagged PDF.
    generateDocumentOutline: o.outline,
    generateTaggedPDF: true,
  }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const FIRST = /^(index|readme)\.(md|markdown)$/i

/**
 * The documents of a folder in the order of a book: in each folder its
 * `index.md` / `README.md` first, then its documents by name, then its
 * subfolders, the same way. Hidden files and tooling folders are left out;
 * a document is what the tree lists (Markdown, diagrams, API descriptions).
 */
export function folderDocuments(dir: string, depth = 0): string[] {
  if (depth > 12) return []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const files: string[] = []
  const dirs: string[] = []
  for (const name of names) {
    if (name.startsWith('.') || SKIP.has(name)) continue
    const path = join(dir, name)
    let isDir: boolean
    try {
      isDir = statSync(path).isDirectory()
    } catch {
      continue
    }
    if (isDir) dirs.push(name)
    else if (kindOf(name) !== 'other') files.push(name)
  }
  files.sort((a, b) => (FIRST.test(a) ? 0 : 1) - (FIRST.test(b) ? 0 : 1) || byName(a, b))
  dirs.sort(byName)
  return [...files.map((f) => join(dir, f)), ...dirs.flatMap((d) => folderDocuments(join(dir, d), depth + 1))]
}

/** The PDF's file name: the document's without its extension, or the folder's. */
export function pdfName(path: string): string {
  return `${basename(path, extname(path)) || 'document'}.pdf`
}
