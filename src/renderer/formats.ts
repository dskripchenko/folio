/**
 * Drawing and editing a document by its format (ADR-001, stage 5): each with
 * its embed element, its text given as a `<script type="text/plain">` child
 * (never parsed as markup). The view is used for the document, a version
 * from the history and the two sides of a comparison alike.
 */
import type { Format } from './bridge'

/** `<dsk-diagram>`'s syntax by extension, so a notation is never guessed wrong. */
const SYNTAX: Record<string, string> = {
  mmd: 'mermaid',
  mermaid: 'mermaid',
  puml: 'plantuml',
  plantuml: 'plantuml',
  pu: 'plantuml',
  iuml: 'plantuml',
  dot: 'dot',
  gv: 'dot',
  d2: 'd2',
  dbml: 'dbml',
  dsl: 'structurizr',
  wardley: 'wardley',
}

export function syntaxOf(name: string): string | null {
  return SYNTAX[name.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

function withText(tag: string, text: string): HTMLElement {
  const el = document.createElement(tag)
  const source = document.createElement('script')
  source.type = 'text/plain'
  source.textContent = text
  el.append(source)
  return el
}

/** Try-it only where the spec names a server on the web: a relative one would ask folio itself. */
export function hasWebServer(text: string): boolean {
  return /^\s*-?\s*["']?url["']?\s*:\s*["']?https?:\/\//m.test(text) || /^\s*["']?host["']?\s*:/m.test(text)
}

/**
 * A spec without a server on the web: no try-it, and samples against
 * `http://localhost` rather than the window's own `folio://app`.
 */
function localApi(el: HTMLElement, text: string): void {
  if (hasWebServer(text)) return
  el.setAttribute('try-it', 'false')
  el.setAttribute('base-url', 'http://localhost')
}

export interface ViewOptions {
  base?: string
  name: string
  /** The document's own view (a table of contents for Markdown); not a version or one side of a comparison. */
  main?: boolean
}

/** The document drawn, read-only. */
export function viewOf(format: Format, text: string, o: ViewOptions): HTMLElement {
  switch (format) {
    case 'markdown': {
      const md = document.createElement('dsk-markdown')
      if (o.base) {
        md.setAttribute('image-base', o.base)
        md.setAttribute('link-base', o.base)
      }
      if (o.main) md.setAttribute('toc', '')
      const source = document.createElement('script')
      source.type = 'text/markdown'
      source.textContent = text
      md.append(source)
      return md
    }
    case 'bpmn':
    case 'dmn': {
      const el = withText(`dsk-${format}`, text)
      el.setAttribute('height', o.main ? 'calc(100vh - 150px)' : '480')
      return el
    }
    case 'drawio':
      return withText('dsk-drawio', text)
    case 'openapi': {
      const el = withText('dsk-openapi', text)
      localApi(el, text)
      el.setAttribute('hash-navigation', 'false')
      return el
    }
    case 'asyncapi':
      return withText('dsk-asyncapi', text)
    case 'diagram': {
      const el = withText('dsk-diagram', text)
      const syntax = syntaxOf(o.name)
      if (syntax) el.setAttribute('syntax', syntax)
      el.setAttribute('label', o.name)
      return el
    }
    default: {
      const pre = document.createElement('pre')
      pre.className = 'plain-text'
      pre.textContent = text
      return pre
    }
  }
}

/** Formats with an editor of their own; draw.io has none (folio shows it, the source stays as is). */
export function canEdit(format: Format): boolean {
  return format !== 'drawio'
}

/** The editor of a non-Markdown document; `changed` gets the new text after each edit. */
export function editorOf(format: Format, text: string, o: ViewOptions, changed: (text: string) => void): HTMLElement {
  if (format === 'bpmn' || format === 'dmn') {
    const el = withText(`dsk-${format}`, text)
    el.setAttribute('editable', '')
    el.setAttribute('height', 'calc(100vh - 150px)')
    el.addEventListener('dsk:change', (e) => changed((e as CustomEvent<{ xml: string }>).detail.xml))
    return el
  }
  if (format === 'openapi') {
    const el = withText('dsk-openapi', text)
    el.setAttribute('mode', 'editor')
    el.setAttribute('height', 'calc(100vh - 150px)')
    localApi(el, text)
    el.addEventListener('dsk:change', (e) => changed((e as CustomEvent<{ source: string }>).detail.source))
    return el
  }
  return sourceEditor(format, text, o, changed)
}

/**
 * The source beside a live preview (a diagram notation, AsyncAPI), or the
 * source alone (other text). The preview is drawn again once typing pauses.
 */
function sourceEditor(format: Format, text: string, o: ViewOptions, changed: (text: string) => void): HTMLElement {
  const box = document.createElement('div')
  box.className = 'source-editor'
  box.dataset.testid = 'source-editor'
  const area = document.createElement('textarea')
  area.className = 'source'
  area.dataset.testid = 'source'
  area.spellcheck = false
  area.value = text
  area.setAttribute('aria-label', o.name)
  box.append(area)
  const preview = format === 'diagram' || format === 'asyncapi'
  let pane: HTMLElement | null = null
  if (preview) {
    pane = document.createElement('div')
    pane.className = 'preview'
    pane.dataset.testid = 'preview'
    pane.append(viewOf(format, text, o))
    box.append(pane)
  } else box.classList.add('alone')
  let timer: ReturnType<typeof setTimeout> | null = null
  area.addEventListener('input', () => {
    changed(area.value)
    if (!pane) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => pane!.replaceChildren(viewOf(format, area.value, o)), 300)
  })
  // Tab indents, as in a code editor; after Escape it moves on, so the keyboard can leave the field.
  let escaped = false
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') escaped = true
    if (e.key !== 'Tab' || e.shiftKey || escaped) return
    e.preventDefault()
    area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end')
    area.dispatchEvent(new Event('input'))
  })
  area.addEventListener('blur', () => (escaped = false))
  return box
}
