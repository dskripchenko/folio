/**
 * Code, data, logs: any text file with its lines numbered, in the colours of
 * its language. A data file is checked (errors at the line numbers, a count
 * in the head stepping through them); blocks fold by the arrows beside the
 * numbers. A big file draws only the lines in view — a 100 MB log scrolls as
 * a small one — and a log filters by level, a stack trace kept with its entry.
 */
import {
  canValidate,
  escapeHtml,
  foldRanges,
  highlightLines,
  languageOf,
  languages,
  LineHighlighter,
  logEntries,
  THEME_CSS,
  validate,
  type Diagnostic,
  type LogLevel,
} from '@dskripchenko/syntax'

/** Drawn whole — every line in the page, folding, checking — up to here; past it, only the lines in view. */
const WHOLE = { bytes: 2 * 1024 * 1024, lines: 20_000 }
/** Edited as text up to here; a bigger file is read. */
export const READ_ONLY_BYTES = 5 * 1024 * 1024
/** A line's height and the list's padding, in pixels: `.code-lines` is 12.5px/1.6. */
const ROW = 20
const PAD = 10
/** Rows drawn above and below the view, so a scroll does not show them blank. */
const BUFFER = 40
/** A line longer than this (minified code) is drawn cut in a big file. */
const LONG_LINE = 2000

type Level = LogLevel | 'none'
const LEVELS: Level[] = ['error', 'warning', 'info', 'debug', 'none']

/** What the view keeps over redraws: the levels a log hides. */
export interface CodeState {
  hidden?: Level[]
}

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

const WORDS = {
  ru: {
    lines: ['строка', 'строки', 'строк'] as const,
    errors: ['ошибка', 'ошибки', 'ошибок'] as const,
    warnings: ['предупреждение', 'предупреждения', 'предупреждений'] as const,
    next: 'К следующей',
    levels: { error: 'Ошибки', warning: 'Предупреждения', info: 'Инфо', debug: 'Отладка', none: 'Прочее' },
    filter: 'Показать или скрыть записи этого уровня',
    cut: 'строка обрезана',
  },
  en: {
    lines: ['line', 'lines'] as const,
    errors: ['error', 'errors'] as const,
    warnings: ['warning', 'warnings'] as const,
    next: 'To the next one',
    levels: { error: 'Errors', warning: 'Warnings', info: 'Info', debug: 'Debug', none: 'Other' },
    filter: 'Show or hide the entries of this level',
    cut: 'the line is cut',
  },
}

export function codeView(text: string, name: string, state: CodeState = {}): HTMLElement {
  syntaxTheme()
  const ru = document.documentElement.lang === 'ru'
  const w = ru ? WORDS.ru : WORDS.en
  const language = languageOf(name, text.slice(0, 200).split('\n')[0])
  // A final line break ends the last line; it does not start another.
  const source = text.replace(/\r?\n$/, '')
  const h = new LineHighlighter(source, language ?? 'text')
  const count = h.lineCount
  const whole = source.length <= WHOLE.bytes && count <= WHOLE.lines

  const box = document.createElement('div')
  box.className = 'code-view'
  box.dataset.testid = 'code-view'
  if (language) box.dataset.language = language
  const head = document.createElement('div')
  head.className = 'code-head'
  const label = document.createElement('span')
  label.textContent = [language ? LANGUAGE_NAMES.get(language) : null, ru ? `строк: ${count.toLocaleString('ru')}` : plural(count, ru, WORDS.ru.lines, WORDS.en.lines)].filter(Boolean).join(' · ')
  head.append(label)

  const diagnostics = language && whole && canValidate(language) ? validate(source, language) : []
  const byLine = new Map<number, Diagnostic[]>()
  for (const d of diagnostics) byLine.set(d.line, [...(byLine.get(d.line) ?? []), d])

  // A log: every line's level is its entry's (a stack trace is its error's).
  const levelOf = language === 'log' ? new Uint8Array(count) : null
  const totals = new Map<Level, number>()
  if (levelOf) {
    for (const e of logEntries(source)) {
      const level: Level = e.level ?? 'none'
      totals.set(level, (totals.get(level) ?? 0) + 1)
      levelOf.fill(LEVELS.indexOf(level), e.start - 1, e.end)
    }
  }
  const hidden = new Set<Level>(state.hidden ?? [])
  const isShown = (i: number): boolean => !levelOf || !hidden.has(LEVELS[levelOf[i]!]!)

  const pre = document.createElement('pre')
  pre.className = 'code-lines'
  pre.style.setProperty('--gutter', `${String(count).length + 1}ch`)

  const attrsOf = (n: number): string => {
    const attrs = [`data-n="${n}"`]
    const found = byLine.get(n)
    if (found) {
      const severity = found.some((d) => d.severity === 'error') ? 'error' : 'warning'
      attrs.push(`data-diagnostic="${severity}"`, `title="${escapeHtml(found.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'))}"`)
    }
    if (levelOf) attrs.push(`data-level="${LEVELS[levelOf[n - 1]!]}"`)
    return attrs.join(' ')
  }

  // Each mode: how to show the filter, and how to bring a line into view.
  let applyFilter: () => void
  let goTo: (n: number) => HTMLElement | null

  if (whole) {
    const html = language ? highlightLines(source, language) : null
    const folds = new Map(language ? foldRanges(source, language).map((f) => [f.start, f.end]) : [])
    const parts: string[] = []
    for (let i = 0; i < count; i++) {
      const n = i + 1
      // Each line its own element: the gutter numbers it from an attribute, never part of the text.
      const body = html ? (html[i] ?? '') : escapeHtml(h.line(i))
      const end = folds.get(n)
      const toggle = end ? `<span class="code-fold" data-testid="fold-${n}" role="button" aria-expanded="true"></span>` : '<span class="code-fold"></span>'
      // The line break inside the line: a copy keeps it, a folded line hides it with itself.
      parts.push(`<span class="code-line" ${attrsOf(n)}${end ? ` data-fold-end="${end}"` : ''}>${toggle}${body}${n < count ? '\n' : ''}</span>`)
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
        const depth = Number(r.dataset.hidden ?? 0) + (fold ? 1 : -1)
        if (depth > 0) r.dataset.hidden = String(depth)
        else delete r.dataset.hidden
      }
    })
    applyFilter = () => rows.forEach((r, i) => r.toggleAttribute('data-filtered', !isShown(i)))
    goTo = (n) => {
      // Unfold whatever hides it.
      for (const r of rows) if (r.dataset.folded === 'true' && Number(r.dataset.n) < n && Number(r.dataset.foldEnd) >= n) r.querySelector<HTMLElement>('.code-fold')!.click()
      return rows[n - 1] ?? null
    }
  } else {
    // Only the lines in view are in the page: a window of rows placed at their offset.
    pre.dataset.virtual = ''
    const win = document.createElement('div')
    win.className = 'code-window'
    pre.append(win)
    let shown = new Int32Array(0)
    let drawn: [number, number] = [-1, -1]

    const rowsHtml = (first: number, last: number): string => {
      const parts: string[] = []
      // Consecutive lines are highlighted together (one pass from the nearest checkpoint).
      let k = first
      while (k < last) {
        let end = k + 1
        while (end < last && shown[end] === shown[end - 1]! + 1) end++
        const from = shown[k]!
        const html = h.html(from, shown[end - 1]! + 1, LONG_LINE)
        html.forEach((body, j) => {
          const i = from + j
          const cut = h.line(i).length > LONG_LINE ? ` data-cut="${w.cut}"` : ''
          parts.push(`<span class="code-line" ${attrsOf(i + 1)}${cut}><span class="code-fold"></span>${body}${i + 1 < count ? '\n' : ''}</span>`)
        })
        k = end
      }
      return parts.join('')
    }

    const draw = (force = false, around?: number): void => {
      const rect = pre.getBoundingClientRect()
      if (rect.height === 0) return
      let first: number
      if (around !== undefined) first = around - Math.ceil(innerHeight / ROW / 2)
      else first = Math.floor((-rect.top - PAD) / ROW)
      first = Math.max(0, first - BUFFER)
      const last = Math.min(shown.length, first + Math.ceil(innerHeight / ROW) + 2 * BUFFER)
      // Still inside what is drawn: nothing to do.
      if (!force && first >= drawn[0] && last <= drawn[1]) return
      const from = Math.max(0, first - BUFFER)
      const to = Math.min(shown.length, last + BUFFER)
      drawn = [from, to]
      win.style.top = `${PAD + from * ROW}px`
      win.innerHTML = rowsHtml(from, to)
    }

    let pending = false
    const onScroll = (): void => {
      if (!pre.isConnected) {
        document.removeEventListener('scroll', onScroll, true)
        removeEventListener('resize', onScroll)
        observer.disconnect()
        return
      }
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        draw()
      })
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    addEventListener('resize', onScroll)
    // Laid out (or shown again after another tab): draw what is in view.
    const observer = new ResizeObserver(() => draw(true))
    observer.observe(pre)

    applyFilter = () => {
      const list: number[] = []
      for (let i = 0; i < count; i++) if (isShown(i)) list.push(i)
      shown = Int32Array.from(list)
      pre.style.height = `${shown.length * ROW + 2 * PAD}px`
      draw(true)
    }
    goTo = (n) => {
      let lo = 0
      let hi = shown.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (shown[mid]! < n - 1) lo = mid + 1
        else hi = mid
      }
      if (shown[lo] !== n - 1) return null
      draw(true, lo)
      return win.querySelector<HTMLElement>(`.code-line[data-n="${n}"]`)
    }
  }

  if (levelOf) {
    const chips = document.createElement('span')
    chips.className = 'code-levels'
    chips.dataset.testid = 'code-levels'
    for (const level of LEVELS) {
      const n = totals.get(level)
      if (!n) continue
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'code-level'
      chip.dataset.level = level
      chip.dataset.testid = `level-${level}`
      chip.title = w.filter
      chip.setAttribute('aria-pressed', String(!hidden.has(level)))
      chip.textContent = `${w.levels[level]} ${n.toLocaleString(ru ? 'ru' : 'en')}`
      chip.addEventListener('click', () => {
        if (hidden.has(level)) hidden.delete(level)
        else hidden.add(level)
        chip.setAttribute('aria-pressed', String(!hidden.has(level)))
        state.hidden = [...hidden]
        applyFilter()
      })
      chips.append(chip)
    }
    head.append(chips)
  }

  if (diagnostics.length > 0) {
    const errors = diagnostics.filter((d) => d.severity === 'error').length
    const warnings = diagnostics.length - errors
    const step = document.createElement('button')
    step.type = 'button'
    step.className = 'code-problems'
    step.dataset.testid = 'code-problems'
    step.dataset.severity = errors > 0 ? 'error' : 'warning'
    step.textContent = [errors ? plural(errors, ru, WORDS.ru.errors, WORDS.en.errors) : null, warnings ? plural(warnings, ru, WORDS.ru.warnings, WORDS.en.warnings) : null].filter(Boolean).join(', ')
    step.title = w.next
    const marked = [...byLine.keys()].sort((a, b) => a - b)
    let next = 0
    step.addEventListener('click', () => {
      const row = goTo(marked[next % marked.length]!)
      next++
      if (!row) return
      row.scrollIntoView({ block: 'center' })
      row.classList.remove('code-flash')
      void row.offsetWidth
      row.classList.add('code-flash')
    })
    head.append(step)
  }

  applyFilter()
  box.append(head, pre)
  return box
}

function plural(n: number, ru: boolean, ruForms: readonly [string, string, string], en: readonly [string, string]): string {
  if (!ru) return `${n.toLocaleString('en')} ${n === 1 ? en[0] : en[1]}`
  const m10 = n % 10
  const m100 = n % 100
  const form = m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2
  return `${n.toLocaleString('ru')} ${ruForms[form]}`
}
