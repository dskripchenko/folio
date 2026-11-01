/**
 * Searching the files' text (Cmd+Shift+F): a panel beside the page — the
 * query, case / whole word / regular expression, where to look (everything,
 * Shared, a project); the matches come in as the main process finds them,
 * by file, each line with its match; a click opens the file at the match.
 */
import type { FindOptions } from '../common/pattern'
import { icon, iconButton } from './icons'

export interface SearchText {
  title: string
  placeholder: string
  caseSensitive: string
  wholeWord: string
  regex: string
  close: string
  everywhere: string
  shared: string
  searching: string
  /** `{matches} in {files}` */
  summary: string
  truncated: string
  none: string
  invalid: string
  matches: [string, string, string] | [string, string]
  files: [string, string, string] | [string, string]
}

interface Hit {
  line: number
  preview: string
  start: number
  end: number
}

export interface FileHits {
  root: string
  label: string | null
  path: string
  hits: Hit[]
  more: boolean
}

export interface SearchBridge {
  scopes(): Promise<{ root: string; label: string | null }[]>
  run(id: number, query: string, options: FindOptions, scope: string): Promise<{ files: number; matches: number; truncated: boolean; canceled: boolean } | { error: string }>
  cancel(): void
  onHits(callback: (id: number, batch: unknown) => void): void
}

const OPTIONS_KEY = 'folio.search'

export class SearchPanel {
  readonly el: HTMLElement
  private readonly input: HTMLInputElement
  private readonly scope: HTMLSelectElement
  private readonly status: HTMLElement
  private readonly results: HTMLElement
  private readonly flags = new Map<keyof FindOptions, HTMLButtonElement>()
  private options: FindOptions = { caseSensitive: false, wholeWord: false, regex: false }
  private id = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private matches = 0

  constructor(
    private text: SearchText,
    private readonly bridge: SearchBridge,
    /** Open the file at the match: the query, its options and the match's place among the file's. */
    private readonly openHit: (file: FileHits, index: number, query: string, options: FindOptions) => void,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    try {
      Object.assign(this.options, JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}'))
    } catch {
      /* the defaults */
    }
    this.el = document.createElement('aside')
    this.el.className = 'search-panel'
    this.el.dataset.testid = 'search-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'search-title'
    const close = iconButton('close', text.close, () => this.setVisible(false))
    close.dataset.testid = 'search-close'
    header.append(title, close)

    const row = document.createElement('div')
    row.className = 'search-row'
    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.spellcheck = false
    this.input.dataset.testid = 'search-input'
    row.append(this.input)
    for (const [key, glyph] of [['caseSensitive', 'Aa'], ['wholeWord', 'ab'], ['regex', '.*']] as const) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'find-flag'
      b.textContent = glyph
      b.dataset.testid = `search-${key}`
      b.setAttribute('aria-pressed', String(this.options[key]))
      b.addEventListener('click', () => {
        this.options[key] = !this.options[key]
        b.setAttribute('aria-pressed', String(this.options[key]))
        try {
          localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options))
        } catch {
          /* kept for this window only */
        }
        this.run()
      })
      this.flags.set(key, b)
      row.append(b)
    }
    this.scope = document.createElement('select')
    this.scope.className = 'search-scope'
    this.scope.dataset.testid = 'search-scope'
    this.scope.addEventListener('change', () => this.run())
    this.status = document.createElement('div')
    this.status.className = 'search-status'
    this.status.dataset.testid = 'search-status'
    this.status.setAttribute('aria-live', 'polite')
    this.results = document.createElement('div')
    this.results.className = 'search-results'
    this.results.dataset.testid = 'search-results'
    this.el.append(header, row, this.scope, this.status, this.results)
    this.setText(text)

    this.input.addEventListener('input', () => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.run(), 300)
    })
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.run()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.setVisible(false)
      }
    })
    bridge.onHits((id, batch) => {
      if (id === this.id) this.add(batch as FileHits[])
    })
  }

  setText(text: SearchText): void {
    this.text = text
    this.el.querySelector('.search-title')!.textContent = text.title
    this.el.setAttribute('aria-label', text.title)
    this.input.placeholder = text.placeholder
    for (const [key, b] of this.flags) {
      b.title = text[key]
      b.setAttribute('aria-label', text[key])
    }
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(visible: boolean): void {
    if (this.el.hidden === !visible) return
    this.el.hidden = !visible
    if (!visible) {
      this.bridge.cancel()
      this.id++
    }
    this.onVisibility(visible)
  }

  /** Open with the focus in the query (a selection on the page becomes it); the places to look listed afresh. */
  async open(): Promise<void> {
    const selected = getSelection()?.toString() ?? ''
    if (selected && !selected.includes('\n') && selected.length < 200) this.input.value = selected
    this.setVisible(true)
    this.input.focus()
    this.input.select()
    const current = this.scope.value
    const scopes = await this.bridge.scopes()
    this.scope.replaceChildren(
      new Option(this.text.everywhere, 'all'),
      ...scopes.map((s) => new Option(s.label ?? this.text.shared, s.root)),
    )
    this.scope.value = [...this.scope.options].some((o) => o.value === current) ? current : 'all'
    if (this.input.value !== '') this.run()
  }

  private async run(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    const id = ++this.id
    this.results.replaceChildren()
    this.matches = 0
    const query = this.input.value
    if (query === '') {
      this.bridge.cancel()
      this.status.textContent = ''
      return
    }
    this.status.textContent = this.text.searching
    const result = await this.bridge.run(id, query, { ...this.options }, this.scope.value || 'all')
    if (id !== this.id) return
    if ('error' in result) {
      this.status.textContent = this.text.invalid
      return
    }
    if (result.canceled) return
    this.status.textContent =
      result.matches === 0
        ? this.text.none
        : this.text.summary.replace('{matches}', plural(result.matches, this.text.matches)).replace('{files}', plural(result.files, this.text.files)) + (result.truncated ? ` ${this.text.truncated}` : '')
  }

  private add(batch: FileHits[]): void {
    const query = this.input.value
    const options = { ...this.options }
    for (const file of batch) {
      this.matches += file.hits.length
      const group = document.createElement('section')
      group.className = 'search-file'
      group.dataset.testid = 'search-file'
      group.dataset.path = file.path
      const head = document.createElement('button')
      head.type = 'button'
      head.className = 'search-file-head'
      head.setAttribute('aria-expanded', 'true')
      const name = document.createElement('span')
      name.className = 'search-file-name'
      name.textContent = file.path.split('/').pop()!
      const where = document.createElement('span')
      where.className = 'search-file-where'
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      where.textContent = [file.label ?? this.text.shared, dir].filter(Boolean).join('/')
      const count = document.createElement('span')
      count.className = 'search-file-count'
      count.textContent = `${file.hits.length}${file.more ? '+' : ''}`
      head.append(icon('chevron'), name, where, count)
      const list = document.createElement('ul')
      head.addEventListener('click', () => {
        const open = head.getAttribute('aria-expanded') !== 'true'
        head.setAttribute('aria-expanded', String(open))
        list.hidden = !open
      })
      file.hits.forEach((hit, i) => {
        const li = document.createElement('li')
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'search-hit'
        b.dataset.testid = 'search-hit'
        b.dataset.line = String(hit.line)
        const n = document.createElement('span')
        n.className = 'search-line'
        n.textContent = String(hit.line)
        const mark = document.createElement('b')
        mark.textContent = hit.preview.slice(hit.start, hit.end)
        const text = document.createElement('span')
        text.className = 'search-preview'
        text.append(hit.preview.slice(0, hit.start).trimStart(), mark, hit.preview.slice(hit.end))
        b.append(n, text)
        b.addEventListener('click', () => {
          for (const on of this.results.querySelectorAll('.search-hit.on')) on.classList.remove('on')
          b.classList.add('on')
          this.openHit(file, i, query, options)
        })
        li.append(b)
        list.append(li)
      })
      group.append(head, list)
      this.results.append(group)
    }
  }
}

/** `3 matches`, `3 совпадения`: the form for the number, from two (en) or three (ru) forms. */
function plural(n: number, forms: readonly string[]): string {
  if (forms.length === 2) return `${n.toLocaleString('en')} ${n === 1 ? forms[0] : forms[1]}`
  const m10 = n % 10
  const m100 = n % 100
  const form = m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2
  return `${n.toLocaleString('ru')} ${forms[form]}`
}
