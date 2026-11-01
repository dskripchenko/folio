/**
 * The print page (ADR-001, stage 7): a hidden window lays the job's documents
 * out for a PDF — each document from a new page, every widget in its print
 * form (embed's `print.prepare`), heading ids unique across documents, links
 * between them turned into links within the PDF, and a table of contents —
 * then tells the main process it can print.
 */
import type { Format } from './bridge'
import { viewOf } from './formats'

interface PdfJob {
  title: string
  lang: string
  options: { toc: boolean }
  docs: { name: string; text: string; base: string | null; format: Format; urls: string[] }[]
}

type Api = { pdfJob(): Promise<PdfJob | null>; pdfReady(ok: boolean): void }
type Embed = { configure(o: Record<string, unknown>): void; print: { prepare(root?: ParentNode): Promise<() => void> } }
const api = (window as unknown as { folio: Api }).folio
const embed = (window as unknown as { DskEmbed?: Embed }).DskEmbed

const TEXT = {
  en: { contents: 'Contents', documents: (n: number) => `${n} document${n === 1 ? '' : 's'}` },
  ru: { contents: 'Содержание', documents: (n: number) => `Документов: ${n}` },
}

const noExtension = (url: string) => url.replace(/\.(md|markdown|mdown|mkd|mdx)$/i, '')

/** Headings ids, unique in the PDF; links to them within their document follow. */
function uniqueIds(section: HTMLElement, prefix: string): void {
  const renamed = new Map<string, string>()
  for (const h of section.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) {
    const id = `${prefix}-${h.id}`
    renamed.set(h.id, id)
    h.id = id
  }
  for (const a of section.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const id = renamed.get(decodeURIComponent(a.getAttribute('href')!.slice(1)))
    if (id) a.setAttribute('href', `#${id}`)
  }
}

/** A link to another document of the PDF goes to its first page in the PDF. */
function linksWithin(root: HTMLElement, docs: PdfJob['docs']): void {
  const target = new Map<string, string>()
  docs.forEach((d, i) => {
    for (const url of d.urls) {
      target.set(url, `doc-${i}`)
      target.set(noExtension(url), `doc-${i}`)
    }
  })
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const [path, hash] = a.href.split('#')
    const id = target.get(path!) ?? target.get(noExtension(path!))
    if (!id) continue
    const section = document.getElementById(id)
    const inner = hash ? section?.querySelector<HTMLElement>(`[id="${id.replace('doc-', 'd')}-${CSS.escape(decodeURIComponent(hash))}"]`) : null
    a.setAttribute('href', `#${inner?.id ?? id}`)
  }
}

function titleOf(section: HTMLElement, fallback: string): string {
  return section.querySelector('h1')?.textContent?.trim() || fallback
}

/** One document: its headings down to h3. A folder: each document, with its h2s. */
function tableOfContents(job: PdfJob, sections: HTMLElement[]): HTMLElement {
  const t = job.lang === 'ru' ? TEXT.ru : TEXT.en
  const nav = document.createElement('nav')
  nav.className = 'pdf-toc'
  const h = document.createElement('h1')
  h.textContent = job.docs.length > 1 ? job.title : t.contents
  nav.append(h)
  if (job.docs.length > 1) {
    const sub = document.createElement('p')
    sub.className = 'subtitle'
    sub.textContent = `${t.contents} · ${t.documents(job.docs.length)}`
    nav.append(sub)
  }
  const list = (items: { text: string; href: string; children?: { text: string; href: string }[] }[]) => {
    const ol = document.createElement('ol')
    for (const item of items) {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = item.href
      a.textContent = item.text
      li.append(a)
      if (item.children?.length) li.append(list(item.children))
      ol.append(li)
    }
    return ol
  }
  const headings = (s: HTMLElement, selector: string) => [...s.querySelectorAll<HTMLElement>(selector)].filter((x) => x.id && x.textContent?.trim()).map((x) => ({ text: x.textContent!.trim(), href: `#${x.id}` }))
  if (job.docs.length === 1) {
    const s = sections[0]!
    const items: { text: string; href: string; children: { text: string; href: string }[] }[] = []
    for (const x of s.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]')) {
      if (!x.textContent?.trim()) continue
      const entry = { text: x.textContent.trim(), href: `#${x.id}`, children: [] as { text: string; href: string }[] }
      if (x.tagName === 'H3' && items.length) items[items.length - 1]!.children.push(entry)
      else items.push(entry)
    }
    nav.append(list(items))
  } else {
    nav.append(list(sections.map((s, i) => ({ text: titleOf(s, job.docs[i]!.name), href: `#${s.id}`, children: headings(s, 'h2[id]') }))))
  }
  return nav
}

async function main(): Promise<void> {
  const job = await api.pdfJob()
  if (!job || !embed) return api.pdfReady(false)
  document.title = job.title
  document.documentElement.lang = job.lang
  embed.configure({ theme: 'light', locale: job.lang })
  const root = document.querySelector<HTMLElement>('.pdf')!
  const sections = job.docs.map((d, i) => {
    const s = document.createElement('section')
    s.className = 'pdf-doc'
    s.id = `doc-${i}`
    // A drawing has no heading of its own: its name, for the contents and the bookmarks.
    if (d.format !== 'markdown' && job.docs.length > 1) {
      const h = document.createElement('h1')
      h.className = 'pdf-doc-title'
      h.id = `doc-${i}-title`
      h.textContent = d.name
      s.append(h)
    }
    s.append(viewOf(d.format, d.text, { base: d.base ?? undefined, name: d.name }))
    root.append(s)
    return s
  })
  // The elements started (their plugins loaded), then every widget drawn and in its print form:
  // prepare waits for what is still drawing, once a plugin is there to know about it.
  await Promise.all([...root.querySelectorAll<HTMLElement & { ready?: Promise<void> }>('[data-dsk]')].map((el) => el.ready))
  await embed.print.prepare(document)
  sections.forEach((s, i) => uniqueIds(s, `d${i}`))
  linksWithin(root, job.docs)
  if (job.options.toc) root.prepend(tableOfContents(job, sections))
  // Pictures arrive before the pages are cut.
  await Promise.all(
    [...document.images].map((img) =>
      img.complete
        ? null
        : new Promise((done) => {
            img.addEventListener('load', done, { once: true })
            img.addEventListener('error', done, { once: true })
          }),
    ),
  )
  api.pdfReady(true)
}

void main().catch((error: unknown) => {
  console.error('[folio] print page failed', error)
  api.pdfReady(false)
})
