/**
 * Drawing and editing a document by its format (ADR-001, stage 5): each with
 * its embed element, its text given as a `<script type="text/plain">` child
 * (never parsed as markup). The view is used for the document, a version
 * from the history and the two sides of a comparison alike.
 */
import { canValidate, foldRanges, highlightLines, languageOf, languages, THEME_CSS, validate, type Diagnostic } from '@dskripchenko/syntax'
import type { Format } from './bridge'

/** Highlighting this much is still instant; a bigger file is shown as plain lines (large files: a later stage). */
const HIGHLIGHT_LIMIT = { bytes: 2 * 1024 * 1024, lines: 50_000 }

let themed = false
/** The token colours, once per window: light and dark follow folio's theme (`data-theme`, or the system's). */
function syntaxTheme(): void {
  if (themed) return
  themed = true
  const style = document.createElement('style')
  style.dataset.syntax = ''
  style.textContent = THEME_CSS
  document.head.prepend(style)
}

const LANGUAGE_NAMES = new Map(languages().map((l) => [l.id, l.name]))

/**
 * Any other text file: its lines numbered (numbers stay out of a copy), in
 * the colours of its language — by name, extension or the `#!` line — or
 * plain when no language is known or the file is too big to highlight at once.
 * A data file is checked (errors marked at the line numbers, a count in the
 * head that steps through them); blocks fold by the arrows beside the numbers.
 */
export function codeView(text: string, name: string): HTMLElement {
  syntaxTheme()
  const language = languageOf(name, text.slice(0, 200).split('\n')[0])
  // A final line break ends the last line; it does not start another.
  const source = text.replace(/\r?\n$/, '')
  const lines = source.split(/\r?\n/)
  const tooBig = text.length > HIGHLIGHT_LIMIT.bytes || lines.length > HIGHLIGHT_LIMIT.lines
  const box = document.createElement('div')
  box.className = 'code-view'
  box.dataset.testid = 'code-view'
  if (language) box.dataset.language = language
  const ru = document.documentElement.lang === 'ru'
  const head = document.createElement('div')
  head.className = 'code-head'
  const count = ru ? `строк: ${lines.length.toLocaleString('ru')}` : `${lines.length.toLocaleString('en')} ${lines.length === 1 ? 'line' : 'lines'}`
  const plain = ru ? 'без подсветки: файл большой' : 'not highlighted: the file is big'
  const label = document.createElement('span')
  label.textContent = [language ? LANGUAGE_NAMES.get(language) : null, count, tooBig ? plain : null].filter(Boolean).join(' · ')
  head.append(label)

  const html = language && !tooBig ? highlightLines(source, language) : null
  const diagnostics = language && !tooBig && canValidate(language) ? validate(source, language) : []
  const folds = language && !tooBig ? foldRanges(source, language) : []
  const byLine = new Map<number, Diagnostic[]>()
  for (const d of diagnostics) byLine.set(d.line, [...(byLine.get(d.line) ?? []), d])
  const foldAt = new Map(folds.map((f) => [f.start, f.end]))

  const pre = document.createElement('pre')
  pre.className = 'code-lines'
  pre.style.setProperty('--gutter', `${String(lines.length).length + 1}ch`)
  const parts: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    // Each line its own element: the gutter numbers it from an attribute, never part of the text.
    const body = html ? html[i] ?? '' : escapeText(lines[i]!)
    const found = byLine.get(n)
    const severity = found ? (found.some((d) => d.severity === 'error') ? 'error' : 'warning') : null
    const attrs = [`data-n="${n}"`]
    if (severity) attrs.push(`data-diagnostic="${severity}"`, `title="${escapeAttr(found!.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'))}"`)
    const end = foldAt.get(n)
    if (end) attrs.push(`data-fold-end="${end}"`)
    const toggle = end ? `<span class="code-fold" data-testid="fold-${n}" role="button" aria-expanded="true"></span>` : '<span class="code-fold"></span>'
    // The line break inside the line: a copy keeps it, a folded line hides it with itself.
    parts.push(`<span class="code-line" ${attrs.join(' ')}>${toggle}${body}${n < lines.length ? '\n' : ''}</span>`)
  }
  pre.innerHTML = parts.join('')
  const rows = [...pre.children] as HTMLElement[]

  // Folding: a line hidden while any range holding it is folded (ranges nest).
  pre.addEventListener('click', (e) => {
    const toggle = (e.target as HTMLElement).closest<HTMLElement>('.code-fold[role="button"]')
    if (!toggle) return
    const row = toggle.parentElement!
    const start = Number(row.dataset.n)
    const end = Number(row.dataset.foldEnd)
    const fold = row.dataset.folded !== 'true'
    row.dataset.folded = String(fold)
    toggle.setAttribute('aria-expanded', String(!fold))
    for (let k = start; k < end; k++) {
      const r = rows[k]!
      const hidden = Number(r.dataset.hidden ?? 0) + (fold ? 1 : -1)
      if (hidden > 0) r.dataset.hidden = String(hidden)
      else delete r.dataset.hidden
    }
  })

  if (diagnostics.length > 0) {
    const errors = diagnostics.filter((d) => d.severity === 'error').length
    const warnings = diagnostics.length - errors
    const step = document.createElement('button')
    step.type = 'button'
    step.className = 'code-problems'
    step.dataset.testid = 'code-problems'
    step.dataset.severity = errors > 0 ? 'error' : 'warning'
    step.textContent = [errors ? plural(errors, ru, ['ошибка', 'ошибки', 'ошибок'], ['error', 'errors']) : null, warnings ? plural(warnings, ru, ['предупреждение', 'предупреждения', 'предупреждений'], ['warning', 'warnings']) : null].filter(Boolean).join(', ')
    step.title = ru ? 'К следующей' : 'To the next one'
    const marked = [...new Set(diagnostics.map((d) => d.line))].sort((a, b) => a - b)
    let next = 0
    step.addEventListener('click', () => {
      const n = marked[next % marked.length]!
      next++
      const row = rows[n - 1]!
      // Unfold whatever hides it.
      for (const r of rows) if (r.dataset.folded === 'true' && Number(r.dataset.n) < n && Number(r.dataset.foldEnd) >= n) r.querySelector<HTMLElement>('.code-fold')!.click()
      row.scrollIntoView({ block: 'center' })
      row.classList.remove('code-flash')
      void row.offsetWidth
      row.classList.add('code-flash')
    })
    head.append(step)
  }
  box.append(head, pre)
  return box
}

function plural(n: number, ru: boolean, ruForms: [string, string, string], en: [string, string]): string {
  if (!ru) return `${n} ${n === 1 ? en[0] : en[1]}`
  const m10 = n % 10
  const m100 = n % 100
  const form = m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2
  return `${n} ${ruForms[form]}`
}

const escapeAttr = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const escapeText = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))

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
    default:
      return codeView(text, o.name)
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
