/**
 * A document exported as one HTML page or a Word file (ADR-004 D6), from the
 * document as drawn: widgets in their print form (embed's `print.prepare`),
 * pictures and diagrams taken in. The HTML keeps folio's look in light; the
 * Word file is read from the drawn page into blocks the main process writes.
 */

type Inline =
  | { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean; link?: string }
  | { image: number; width: number; height: number }
  | { break: true }

type Block =
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Block[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: Inline[][][]; header: boolean }
  | { kind: 'rule' }

export interface DocxModel {
  title: string
  blocks: Block[]
  images: { data: Uint8Array; type: 'png' | 'jpeg' }[]
}

type Embed = { print?: { prepare(root?: ParentNode): Promise<() => void> }; configure(o: Record<string, unknown>): void }

/** The document drawn out of sight, its widgets in their print form; `done` takes it away. */
export async function drawn(view: HTMLElement, theme: string): Promise<{ root: HTMLElement; done: () => void }> {
  const host = document.createElement('div')
  host.className = 'export-host doc'
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:860px;pointer-events:none'
  host.append(view)
  document.body.append(host)
  const embed = (window as unknown as { DskEmbed?: Embed }).DskEmbed
  // Light, as on paper.
  embed?.configure({ theme: 'light' })
  const restore = (await embed?.print?.prepare(host)) ?? (() => {})
  return {
    root: host,
    done: () => {
      restore()
      embed?.configure({ theme })
      host.remove()
    },
  }
}

/** A file of the window (a picture of the folder) as bytes and its type. */
async function bytesOf(src: string): Promise<{ data: Uint8Array; type: string } | null> {
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    return { data: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' }
  } catch {
    return null
  }
}

function dataUrl(data: Uint8Array, type: string): string {
  let s = ''
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(s)}`
}

/** The window's rules, but for what only folio can load (its fonts, its own files). */
function rules(): string {
  const out: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList
    try {
      list = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(list)) if (!rule.cssText.includes('folio://')) out.push(rule.cssText)
  }
  return out.join('\n')
}

/** One HTML page: the document as drawn, its pictures inside it, folio's rules, light. */
export async function toHtml(root: HTMLElement, title: string, lang: string): Promise<string> {
  const copy = root.cloneNode(true) as HTMLElement
  copy.removeAttribute('style')
  // The sources the widgets were drawn from, and anything the page would run.
  // …and the controls that do nothing without folio (a code block's copy button).
  copy.querySelectorAll('script, template, button, .export-skip').forEach((el) => el.remove())
  for (const img of Array.from(copy.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!src.startsWith('folio:')) continue
    const got = await bytesOf(src)
    if (got) img.setAttribute('src', dataUrl(got.data, got.type || 'image/png'))
  }
  // folio's own addresses: the bases of a widget gone, a link to another note a path of the folder.
  copy.querySelectorAll('[image-base], [link-base]').forEach((el) => {
    el.removeAttribute('image-base')
    el.removeAttribute('link-base')
  })
  for (const a of Array.from(copy.querySelectorAll('a[href^="folio:"]'))) a.setAttribute('href', (a.getAttribute('href') ?? '').replace(/^folio:\/\/app\/r\/[0-9a-f]+\//, ''))
  // Players and frames have nothing to play from a file alone: their links stay.
  copy.querySelectorAll('video, audio, iframe').forEach((el) => {
    const a = document.createElement('a')
    a.textContent = el.getAttribute('title') ?? el.getAttribute('src') ?? ''
    el.replaceWith(a)
  })
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!doctype html>
<html lang="${esc(lang)}" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="folio">
<title>${esc(title)}</title>
<style>
${rules()}
/* The page alone: none of the window's layout around it. */
html, body { display: block; overflow: auto; height: auto; background: #fff; }
.folio-export { max-width: 860px; margin: 0 auto; padding: 32px 24px 64px; }
</style>
</head>
<body>
<article class="doc folio-export">
${copy.innerHTML}
</article>
</body>
</html>
`
}

/** A drawing (SVG or a picture of any kind) as PNG bytes, at twice its size for sharpness. */
async function rasterize(src: string, width: number, height: number): Promise<Uint8Array | null> {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const w = Math.max(1, Math.round(width || img.naturalWidth))
  const h = Math.max(1, Math.round(height || img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = w * 2
  canvas.height = h * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** The page read into Word's blocks: headings, paragraphs, lists, quotes, code, tables, pictures. */
export async function toDocx(root: HTMLElement, title: string): Promise<DocxModel> {
  const images: DocxModel['images'] = []

  const picture = async (el: Element): Promise<Inline | null> => {
    const box = el.getBoundingClientRect()
    if (el instanceof HTMLImageElement) {
      const src = el.currentSrc || el.src
      const got = await bytesOf(src)
      const w = box.width || el.naturalWidth
      const h = box.height || el.naturalHeight
      if (got && /image\/(png|jpe?g)/.test(got.type)) {
        images.push({ data: got.data, type: got.type.includes('png') ? 'png' : 'jpeg' })
      } else {
        const png = await rasterize(src, w, h)
        if (!png) return null
        images.push({ data: png, type: 'png' })
      }
      return { image: images.length - 1, width: w, height: h }
    }
    // A drawing: the SVG as drawn, made a picture.
    const svg = el instanceof SVGSVGElement ? el : el.querySelector('svg')
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    const copy = svg.cloneNode(true) as SVGSVGElement
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    copy.setAttribute('width', String(r.width))
    copy.setAttribute('height', String(r.height))
    // Its colours as drawn: the page's variables do not reach a picture of it.
    inlineStyles(svg, copy)
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
    const png = await rasterize(url, r.width, r.height)
    URL.revokeObjectURL(url)
    if (!png) return null
    images.push({ data: png, type: 'png' })
    return { image: images.length - 1, width: r.width, height: r.height }
  }

  const inlines = async (node: Node, style: Omit<Extract<Inline, { text: string }>, 'text'> = {}): Promise<Inline[]> => {
    const out: Inline[] = []
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? '').replace(/\s+/g, ' ')
        if (text) out.push({ text, ...style })
        continue
      }
      if (!(child instanceof Element)) continue
      const tag = child.tagName.toLowerCase()
      if (tag === 'br') out.push({ break: true })
      else if (tag === 'img' || tag === 'svg') {
        const p = await picture(child)
        if (p) out.push(p)
      } else if (tag === 'input' && (child as HTMLInputElement).type === 'checkbox') out.push({ text: (child as HTMLInputElement).checked ? '☑ ' : '☐ ', ...style })
      else if (tag === 'strong' || tag === 'b') out.push(...(await inlines(child, { ...style, bold: true })))
      else if (tag === 'em' || tag === 'i') out.push(...(await inlines(child, { ...style, italic: true })))
      else if (tag === 'del' || tag === 's') out.push(...(await inlines(child, { ...style, strike: true })))
      else if (tag === 'code' || tag === 'kbd') out.push({ text: child.textContent ?? '', ...style, code: true })
      else if (tag === 'a') out.push(...(await inlines(child, { ...style, link: (child as HTMLAnchorElement).href })))
      else if (tag === 'math') out.push({ text: child.textContent ?? '', ...style, italic: true })
      else out.push(...(await inlines(child, style)))
    }
    return out
  }

  const trim = (list: Inline[]): Inline[] => {
    const first = list[0]
    if (first && 'text' in first) list[0] = { ...first, text: first.text.replace(/^\s+/, '') }
    const last = list[list.length - 1]
    if (last && 'text' in last) list[list.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') }
    return list.filter((i) => !('text' in i) || i.text !== '')
  }

  const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr', 'div', 'section', 'figure', 'details', 'dl'])

  const blocks = async (parent: Element): Promise<Block[]> => {
    const out: Block[] = []
    let loose: Inline[] = []
    const flush = () => {
      const t = trim(loose)
      if (t.length) out.push({ kind: 'paragraph', inlines: t })
      loose = []
    }
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        loose.push(...(await inlines({ childNodes: [child] } as unknown as Node)))
        continue
      }
      if (!(child instanceof Element)) continue
      const el = child as HTMLElement
      // Controls drawn around the content (a code block's language and copy button, toolbars) are not the document.
      if (el.hidden || el.matches('script, style, template, .uid-markdown__toc, nav, button, .export-skip, [role="toolbar"], [class*="toolbar"], [class*="__actions"], [class*="__copy"], .uid-code__header, .uid-code__line-numbers')) continue
      const tag = el.tagName.toLowerCase()
      const heading = /^h([1-6])$/.exec(tag)
      if (!BLOCK.has(tag) && !heading && !el.matches('svg, dsk-diagram, dsk-bpmn, dsk-dmn, dsk-drawio, dsk-kanban, dsk-calendar, dsk-board, dsk-flow, dsk-openapi, dsk-asyncapi, dsk-markdown, [class*="uid-"]')) {
        loose.push(...(await inlines({ childNodes: [el] } as unknown as Node)))
        continue
      }
      flush()
      if (heading) out.push({ kind: 'heading', level: Number(heading[1]), inlines: trim(await inlines(el)) })
      else if (tag === 'p') {
        const t = trim(await inlines(el))
        if (t.length) out.push({ kind: 'paragraph', inlines: t })
      } else if (tag === 'ul' || tag === 'ol') {
        const items: Block[][] = []
        for (const li of Array.from(el.children).filter((c) => c.tagName === 'LI')) items.push(await blocks(li))
        out.push({ kind: 'list', ordered: tag === 'ol', items })
      } else if (tag === 'blockquote') out.push({ kind: 'quote', blocks: await blocks(el) })
      else if (tag === 'pre') {
        // The code alone: line numbers drawn beside it are not its text.
        const copy = el.cloneNode(true) as HTMLElement
        copy.querySelectorAll('.uid-code__line-number, .uid-code__line-numbers').forEach((n) => n.remove())
        out.push({ kind: 'code', text: copy.textContent ?? '' })
      }
      else if (tag === 'hr') out.push({ kind: 'rule' })
      else if (tag === 'table') {
        const rows: Inline[][][] = []
        for (const tr of Array.from(el.querySelectorAll('tr'))) {
          const cells: Inline[][] = []
          for (const cell of Array.from(tr.children)) cells.push(trim(await inlines(cell)))
          rows.push(cells)
        }
        out.push({ kind: 'table', rows, header: !!el.querySelector('thead, th') })
      } else if (isDrawing(el)) {
        // A widget drawn as a picture (a diagram, a board): the picture.
        const p = await picture(el)
        if (p) out.push({ kind: 'paragraph', inlines: [p] })
      } else out.push(...(await blocks(el)))
    }
    flush()
    return out
  }

  return { title, blocks: await blocks(root), images }
}

/** A drawing worth a picture: an SVG (or an element holding one and no text blocks) larger than an icon. */
function isDrawing(el: Element): boolean {
  const svg = el.matches('svg') ? el : el.querySelector('svg')
  if (!svg || (!el.matches('svg') && el.querySelector('p, h1, h2, h3, li, table, pre'))) return false
  const r = svg.getBoundingClientRect()
  return r.width > 40 && r.height > 24
}

/** The computed colours, fills, strokes and fonts of an SVG copied onto its copy (a picture has no page around it). */
function inlineStyles(from: Element, to: Element): void {
  const s = getComputedStyle(from)
  const keep = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-anchor', 'dominant-baseline']
  ;(to as SVGElement).setAttribute('style', keep.map((k) => `${k}:${s.getPropertyValue(k)}`).join(';'))
  const a = from.children
  const b = to.children
  for (let i = 0; i < a.length && i < b.length; i++) inlineStyles(a[i]!, b[i]!)
}
