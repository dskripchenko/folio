/**
 * The find bar over the page: the query, case / whole word / regular
 * expression, the count, previous and next. The target is asked for each
 * time (the active tab and its mode decide it); a page that changes under
 * the bar is searched again, the current match kept where it can be.
 */
import { patternOf, type FindOptions, type FindTarget } from './find'
import { iconButton } from './icons'

export interface FindText {
  placeholder: string
  caseSensitive: string
  wholeWord: string
  regex: string
  previous: string
  next: string
  close: string
  none: string
  invalid: string
  /** `{n} of {total}` */
  count: string
}

export interface Retarget {
  target: FindTarget | null
  /** On Escape: hand the current match to the field it is in (select it there). */
  onClose?: (pattern: RegExp | null, index: number) => void
  /** The target searches itself: a change under it is not a reason to search again. */
  own?: boolean
}

const OPTIONS_KEY = 'folio.find'

export class FindBar {
  readonly el: HTMLElement
  private readonly input: HTMLInputElement
  private readonly counter: HTMLElement
  private readonly flags: Record<keyof FindOptions, HTMLButtonElement>
  private options: FindOptions = { caseSensitive: false, wholeWord: false, regex: false }
  private current: Retarget = { target: null }
  private pattern: RegExp | null = null
  private total = 0
  private index = -1
  /** The match to land on once the page has it (a document still being drawn). */
  private wanted: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly observer: MutationObserver

  constructor(
    private text: FindText,
    private readonly targetOf: () => Retarget,
    /** What the bar watches for changes (the documents' area). */
    watched: HTMLElement,
  ) {
    try {
      Object.assign(this.options, JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}'))
    } catch {
      /* the defaults */
    }
    this.el = document.createElement('div')
    this.el.className = 'find-bar'
    this.el.dataset.testid = 'find-bar'
    this.el.hidden = true
    this.el.setAttribute('role', 'search')
    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.placeholder = text.placeholder
    this.input.dataset.testid = 'find-input'
    this.input.spellcheck = false
    this.counter = document.createElement('span')
    this.counter.className = 'find-count'
    this.counter.dataset.testid = 'find-count'
    const flag = (key: keyof FindOptions, label: string, glyph: string): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'find-flag'
      b.textContent = glyph
      b.title = label
      b.setAttribute('aria-label', label)
      b.dataset.testid = `find-${key}`
      b.setAttribute('aria-pressed', String(this.options[key]))
      b.addEventListener('click', () => {
        this.options[key] = !this.options[key]
        b.setAttribute('aria-pressed', String(this.options[key]))
        try {
          localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options))
        } catch {
          /* kept for this window only */
        }
        this.search(true)
        this.input.focus()
      })
      return b
    }
    this.flags = {
      caseSensitive: flag('caseSensitive', text.caseSensitive, 'Aa'),
      wholeWord: flag('wholeWord', text.wholeWord, 'ab'),
      regex: flag('regex', text.regex, '.*'),
    }
    const prev = iconButton('up', text.previous, () => this.step(-1))
    prev.dataset.testid = 'find-prev'
    const next = iconButton('down', text.next, () => this.step(1))
    next.dataset.testid = 'find-next'
    const close = iconButton('close', text.close, () => this.close())
    close.dataset.testid = 'find-close'
    this.el.append(this.input, this.flags.caseSensitive, this.flags.wholeWord, this.flags.regex, this.counter, prev, next, close)

    this.input.addEventListener('input', () => {
      this.wanted = null
      this.search(true)
    })
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.step(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.close(true)
      }
    })
    // The page changed under the bar (a redraw, an edit): search it again.
    this.observer = new MutationObserver(() => this.later())
    this.observer.observe(watched, { subtree: true, childList: true, characterData: true })
    watched.addEventListener('input', () => this.later())
  }

  /** The interface language changed. */
  setText(text: FindText): void {
    this.text = text
    this.input.placeholder = text.placeholder
    for (const [key, b] of Object.entries(this.flags) as [keyof FindOptions, HTMLButtonElement][]) {
      b.title = text[key]
      b.setAttribute('aria-label', text[key])
    }
    for (const [id, label] of [['find-prev', text.previous], ['find-next', text.next], ['find-close', text.close]] as const) {
      const b = this.el.querySelector<HTMLElement>(`[data-testid="${id}"]`)
      b?.setAttribute('title', label)
      b?.setAttribute('aria-label', label)
    }
  }

  get isOpen(): boolean {
    return !this.el.hidden
  }

  /** Open (or focus) the bar; a selection on the page becomes the query. */
  open(): void {
    const selected = getSelection()?.toString() ?? ''
    if (selected && !selected.includes('\n') && selected.length < 200) this.input.value = selected
    this.el.hidden = false
    this.input.focus()
    this.input.select()
    this.retarget()
  }

  /** Open with a query of its own and land on its `index`-th match (from a search in files). */
  openWith(query: string, options: FindOptions, index: number): void {
    this.options = { ...options }
    for (const [key, b] of Object.entries(this.flags) as [keyof FindOptions, HTMLButtonElement][]) b.setAttribute('aria-pressed', String(this.options[key]))
    this.input.value = query
    this.wanted = index
    this.el.hidden = false
    this.retarget()
    this.later()
  }

  close(handOver = false): void {
    if (this.el.hidden) return
    this.el.hidden = true
    this.current.target?.clear()
    if (handOver) this.current.onClose?.(this.pattern, this.index)
  }

  /** The active document changed (another tab, another mode): search it. */
  retarget(): void {
    if (this.el.hidden) return
    this.current.target?.clear()
    this.current = this.targetOf()
    this.search(true)
  }

  /** Cmd+G / Cmd+Shift+G: the next match, opening the bar if needed. */
  step(direction: 1 | -1): void {
    if (this.el.hidden) return this.open()
    if (this.total === 0) return
    this.wanted = null
    this.index = (this.index + direction + this.total) % this.total
    this.show()
  }

  private later(): void {
    if (this.el.hidden) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      // The target may be another now (a redraw replaced the field, a mode changed).
      const next = this.targetOf()
      // A view that searches itself redraws as it scrolls: that is not a change.
      if (next.own && next.target === this.current.target) return
      if (next.target !== this.current.target) this.current.target?.clear()
      this.current = next
      this.search(false)
    }, 250)
  }

  /** Search again; `fresh`: from the first match (a new query), else keep the place. */
  private search(fresh: boolean): void {
    const target = this.current.target
    this.pattern = patternOf(this.input.value, this.options)
    const invalid = this.input.value !== '' && this.pattern === null
    this.el.classList.toggle('invalid', invalid)
    if (!target || !this.pattern) {
      target?.clear()
      this.total = 0
      this.index = -1
      this.counter.textContent = invalid ? this.text.invalid : ''
      return
    }
    // A search under a busy page (a redraw) is not a reason to stop observing it.
    this.observer.takeRecords()
    this.total = target.search(this.pattern)
    this.observer.takeRecords()
    this.index = this.total === 0 ? -1 : fresh ? 0 : Math.min(Math.max(this.index, 0), this.total - 1)
    // Asked to land on a match: once the page has that many.
    if (this.wanted !== null && this.total > this.wanted) {
      this.index = this.wanted
      this.wanted = null
      return this.show(false)
    }
    this.show(!fresh)
  }

  private show(quiet = false): void {
    const target = this.current.target
    if (!target) return
    target.show(this.index, !quiet)
    this.observer.takeRecords()
    this.counter.textContent = this.total === 0 ? this.text.none : this.text.count.replace('{n}', String(this.index + 1)).replace('{total}', this.total >= 10_000 ? '10 000+' : String(this.total))
  }
}
