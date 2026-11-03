/**
 * Drawing and editing a document by its format (ADR-001, stage 5): each with
 * its embed element, its text given as a `<script type="text/plain">` child
 * (never parsed as markup). The view is used for the document, a version
 * from the history and the two sides of a comparison alike.
 */
import { CodeEditor, type CodeEditorOptions, type CompletionSource, type KeyBinding } from '@dskripchenko/code-editor'
import { languageOf } from '@dskripchenko/syntax'
import type { Format } from './bridge'
import { codeView, type CodeState } from './code'

export { READ_ONLY_BYTES } from './code'

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
  /** What the code view keeps over redraws (the levels a log hides). */
  code?: CodeState
  /** Names the code editor offers besides the file's own words (the project's symbols). */
  completion?: CompletionSource
  /** Keys of one's own for the code editor (before its own). */
  keymap?: KeyBinding[]
  /** What a name is, a call's parameters, a definition (a language server's). */
  hover?: CodeEditorOptions['hover']
  signatureHelp?: CodeEditorOptions['signatureHelp']
  onModClick?: CodeEditorOptions['onModClick']
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
    case 'kanban':
    case 'calendar':
      return withText(`dsk-${format}`, text)
    case 'board': {
      const el = withText('dsk-board', text)
      el.setAttribute('height', o.main ? 'calc(100vh - 150px)' : '480')
      return el
    }
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
    default:
      return codeView(text, o.name, o.code)
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
  // A board or a calendar is edited on itself: cards dragged, events moved, the source tab.
  if (format === 'kanban' || format === 'calendar') {
    const el = withText(`dsk-${format}`, text)
    el.setAttribute('editable', '')
    el.addEventListener('dsk:change', (e) => changed((e as CustomEvent<{ source: string }>).detail.source))
    return el
  }
  // A whiteboard is drawn on: the file keeps its JSON, two-space indented, as written by hand.
  if (format === 'board') {
    const el = withText('dsk-board', text)
    el.setAttribute('editable', '')
    el.setAttribute('height', 'calc(100vh - 150px)')
    el.addEventListener('dsk:change', (e) => changed(`${JSON.stringify((e as CustomEvent<{ board: unknown }>).detail.board, null, 2)}\n`))
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

/** A source editor's element: the editor in it, and its text taken now when a change is still pending. */
export type SourceEditorElement = HTMLElement & { folioEditor?: CodeEditor; folioFlush?: () => void; folioCrumbs?: HTMLElement }

/** Up to this many characters the text is taken on every change; a bigger one once typing pauses (a 50 MB string per key is not free). */
const EAGER_CHARS = 1_000_000

/**
 * The source beside a live preview (a diagram notation, AsyncAPI), or the
 * source alone (other text), in the code editor: highlighted, folded and
 * checked as it is typed. The preview is drawn again once typing pauses.
 */
function sourceEditor(format: Format, text: string, o: ViewOptions, changed: (text: string) => void): HTMLElement {
  const box: SourceEditorElement = document.createElement('div')
  box.className = 'source-editor'
  box.dataset.testid = 'source-editor'
  // The breadcrumbs above the text, the text below them.
  const main = document.createElement('div')
  main.className = 'source-main'
  const crumbs = document.createElement('nav')
  crumbs.className = 'code-crumbs'
  crumbs.dataset.testid = 'crumbs'
  const host = document.createElement('div')
  host.className = 'source'
  host.dataset.testid = 'source'
  main.append(crumbs, host)
  box.append(main)
  box.folioCrumbs = crumbs
  const preview = format === 'diagram' || format === 'asyncapi'
  let pane: HTMLElement | null = null
  if (preview) {
    pane = document.createElement('div')
    pane.className = 'preview'
    pane.dataset.testid = 'preview'
    pane.append(viewOf(format, text, o))
    box.append(pane)
  } else box.classList.add('alone')
  let previewTimer: ReturnType<typeof setTimeout> | null = null
  let pending: ReturnType<typeof setTimeout> | null = null
  const take = (): void => {
    if (pending) clearTimeout(pending)
    pending = null
    const value = editor.value
    changed(value)
    if (!pane) return
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => pane!.replaceChildren(viewOf(format, value, o)), 300)
  }
  const editor = new CodeEditor(host, {
    value: text,
    language: languageFor(format, o.name, text) ?? undefined,
    ...(o.completion ? { completion: o.completion } : {}),
    ...(o.keymap?.length ? { keymap: o.keymap } : {}),
    ...(o.hover ? { hover: o.hover } : {}),
    ...(o.signatureHelp ? { signatureHelp: o.signatureHelp } : {}),
    ...(o.onModClick ? { onModClick: o.onModClick } : {}),
    onChange: (e) => {
      if (e.state.doc.length <= EAGER_CHARS) return take()
      if (pending) clearTimeout(pending)
      pending = setTimeout(take, 250)
    },
  })
  editor.dom.setAttribute('aria-label', o.name)
  box.folioEditor = editor
  box.folioFlush = () => {
    if (pending) take()
  }
  return box
}

/** The language a source is highlighted in: by its name, else by what it is (AsyncAPI is YAML or JSON). */
export function languageFor(format: Format, name: string, text: string): string | null {
  const nl = text.indexOf('\n')
  const byName = languageOf(name, text.slice(0, nl < 0 ? 200 : nl))
  if (byName) return byName
  if (format === 'asyncapi' || format === 'openapi') return /^\s*[{[]/.test(text) ? 'json' : 'yaml'
  return null
}
