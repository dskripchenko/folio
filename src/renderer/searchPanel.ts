/**
 * Searching the files' text (Cmd+Shift+F): a panel beside the page — the
 * query, case / whole word / regular expression, where to look (everything,
 * Shared, a project); the matches come in as the main process finds them,
 * by file, each line with its match; a click opens the file at the match.
 */
import { patternOf, type FindOptions } from '../common/pattern'
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
  toggleReplace: string
  replacePlaceholder: string
  replaceAll: string
  /** `Replace {matches} in {files}?` */
  confirm: string
  /** `Replaced {matches} in {files}` */
  replaced: string
  committed: string
  skipped: string
  include: string
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
  file: string
  hits: Hit[]
  more: boolean
}

export interface SearchBridge {
  scopes(): Promise<{ root: string; label: string | null }[]>
  run(id: number, query: string, options: FindOptions, scope: string): Promise<{ files: number; matches: number; truncated: boolean; canceled: boolean } | { error: string }>
  cancel(): void
  onHits(callback: (id: number, batch: unknown) => void): void
  replace(query: string, options: FindOptions, replacement: string, files: string[]): Promise<{ files: number; replacements: number; commits: number } | { error: string }>
  /** A file open in a tab with changes not saved: replacing in it would lose one side. */
  isDirty(file: string): boolean
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
  private readonly replaceRow: HTMLElement
  private readonly replaceInput: HTMLInputElement
  private readonly replaceButton: HTMLButtonElement
  private readonly toggle: HTMLButtonElement
  private found: { file: FileHits; box: HTMLInputElement }[] = []
  private confirming = false

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
    this.toggle = document.createElement('button')
    this.toggle.type = 'button'
    this.toggle.className = 'search-toggle'
    this.toggle.dataset.testid = 'search-toggle-replace'
    this.toggle.setAttribute('aria-expanded', 'false')
    this.toggle.append(icon('chevron'))
    this.toggle.addEventListener('click', () => this.showReplace(this.toggle.getAttribute('aria-expanded') !== 'true'))
    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.spellcheck = false
    this.input.dataset.testid = 'search-input'
    row.append(this.toggle, this.input)
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
    this.replaceRow = document.createElement('div')
    this.replaceRow.className = 'search-row search-replace'
    this.replaceRow.hidden = true
    this.replaceInput = document.createElement('input')
    this.replaceInput.type = 'text'
    this.replaceInput.spellcheck = false
    this.replaceInput.dataset.testid = 'replace-input'
    this.replaceButton = document.createElement('button')
    this.replaceButton.type = 'button'
    this.replaceButton.className = 'search-replace-all'
    this.replaceButton.dataset.testid = 'replace-all'
    this.replaceButton.addEventListener('click', () => void this.replaceAll())
    this.replaceInput.addEventListener('input', () => {
      this.unconfirm()
      this.previews()
    })
    this.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.setVisible(false)
      }
    })
    this.replaceRow.append(this.replaceInput, this.replaceButton)
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
    this.el.append(header, row, this.replaceRow, this.scope, this.status, this.results)
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
    this.toggle.title = text.toggleReplace
    this.toggle.setAttribute('aria-label', text.toggleReplace)
    this.replaceInput.placeholder = text.replacePlaceholder
    this.unconfirm()
  }

  private showReplace(on: boolean): void {
    this.toggle.setAttribute('aria-expanded', String(on))
    this.replaceRow.hidden = !on
    this.el.classList.toggle('replacing', on)
    if (on) this.replaceInput.focus()
    this.previews()
  }

  private unconfirm(): void {
    this.confirming = false
    this.replaceButton.textContent = this.text.replaceAll
    this.replaceButton.classList.remove('confirm')
  }

  /** The files ticked, without the ones open with unsaved changes. */
  private chosen(): FileHits[] {
    return this.found.filter((f) => f.box.checked && !this.bridge.isDirty(f.file.file)).map((f) => f.file)
  }

  /** Replace in every ticked file: the first click asks, the second does it. */
  private async replaceAll(): Promise<void> {
    const files = this.chosen()
    if (files.length === 0 || this.input.value === '') return
    const count = files.reduce((n, f) => n + f.hits.length, 0)
    if (!this.confirming) {
      this.confirming = true
      this.replaceButton.textContent = this.text.confirm.replace('{matches}', plural(count, this.text.matches)).replace('{files}', plural(files.length, this.text.files))
      this.replaceButton.classList.add('confirm')
      return
    }
    this.unconfirm()
    const skipped = this.found.filter((f) => f.box.checked && this.bridge.isDirty(f.file.file)).length
    const result = await this.bridge.replace(this.input.value, { ...this.options }, this.replaceInput.value, files.map((f) => f.file))
    if ('error' in result) {
      this.status.textContent = this.text.invalid
      return
    }
    await this.run()
    this.status.textContent = [
      this.text.replaced.replace('{matches}', plural(result.replacements, this.text.matches)).replace('{files}', plural(result.files, this.text.files)),
      result.commits > 0 ? this.text.committed : '',
      skipped > 0 ? this.text.skipped.replace('{n}', String(skipped)) : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  /** What each match becomes, shown in its line while replacing. */
  private previews(): void {
    const on = !this.replaceRow.hidden
    const pattern = on ? patternOf(this.input.value, this.options) : null
    const single = pattern ? new RegExp(pattern.source, pattern.flags.replace('g', '')) : null
    const replacement = this.options.regex ? this.replaceInput.value : this.replaceInput.value.replace(/\$/g, '$$$$')
    for (const ins of this.results.querySelectorAll<HTMLElement>('.search-preview ins')) {
      const was = ins.previousElementSibling?.textContent ?? ''
      ins.textContent = single ? was.replace(single, replacement) : ''
      ins.hidden = !on
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
    this.found = []
    this.unconfirm()
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
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = true
      box.className = 'search-include'
      box.title = this.text.include
      box.setAttribute('aria-label', `${this.text.include}: ${file.path}`)
      box.dataset.testid = 'search-include'
      box.addEventListener('click', (e) => e.stopPropagation())
      box.addEventListener('change', () => this.unconfirm())
      this.found.push({ file, box })
      head.append(icon('chevron'), box, name, where, count)
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
        const ins = document.createElement('ins')
        ins.hidden = true
        text.append(hit.preview.slice(0, hit.start).trimStart(), mark, ins, hit.preview.slice(hit.end))
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
    this.previews()
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
