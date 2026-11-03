/**
 * Problems found in a task's output (ADR-002, I3): the forms compilers,
 * linters and test runners write them in — `path:line:col: message` (gcc,
 * clang, go, eslint's unix form, ruff, mypy, pytest), tsc's `path(line,col)`,
 * eslint's stylish blocks, rustc's `--> path:line:col`, psalm's — gathered in
 * a panel beside the page, each a way to its place, and marked in the code
 * editor.
 */
import { iconButton } from './icons'

export interface Problem {
  /** As the output names it (relative to the task's folder, or absolute). */
  file: string
  /** 1-based. */
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

const severityOf = (word: string | undefined): Problem['severity'] => {
  const w = (word ?? '').toLowerCase()
  if (/warn/.test(w)) return 'warning'
  if (/note|info|hint/.test(w)) return 'info'
  return 'error'
}

/** A path as tools write it: with an extension, no spaces, not a web address. */
const FILE = '((?:[A-Za-z]:)?(?:[\\w.@+~-]*[\\\\/])*[\\w.@+-]+\\.[A-Za-z0-9]{1,8})'

const TSC = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/
const GENERIC = new RegExp(`^\\s*(?:at\\s+|in\\s+)?${FILE}:(\\d+)(?::(\\d+))?(?::|\\s+-)?\\s*(?:(fatal error|error|warning|warn|note|info|hint)\\b\\s*(?:\\[[^\\]]*\\])?\\s*:?\\s*)?(.*)$`)
const RUST_HEAD = /^(error|warning)(?:\[(\w+)\])?: (.*)$/
const RUST_AT = /^\s*--> (.+?):(\d+):(\d+)/
const PSALM = /^(ERROR|WARNING|INFO): \w+ - (.+?):(\d+):(\d+) - (.*)$/
const ESLINT_FILE = /^((?:[A-Za-z]:)?[\\/]?(?:[\w.@+-]+[\\/])*[\w.@+-]+\.[A-Za-z0-9]{1,8})$/
const ESLINT_ROW = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}(\S+))?$/

/** The problems in an output, each once, in the order met. */
export function parseProblems(output: string): Problem[] {
  const lines = output.replace(ANSI, '').split(/\r?\n/)
  const out: Problem[] = []
  const seen = new Set<string>()
  const push = (p: Problem): void => {
    if (/^https?:/.test(p.file) || p.line < 1) return
    const key = `${p.file}:${p.line}:${p.column}:${p.message}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  let eslintFile: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    let m = TSC.exec(line)
    if (m) {
      push({ file: m[1]!.trim(), line: +m[2]!, column: +m[3]!, severity: severityOf(m[4]), message: `${m[6]} (${m[5]})` })
      continue
    }
    m = RUST_HEAD.exec(line)
    if (m) {
      for (let k = i + 1; k < Math.min(lines.length, i + 4); k++) {
        const at = RUST_AT.exec(lines[k]!)
        if (at) {
          push({ file: at[1]!, line: +at[2]!, column: +at[3]!, severity: severityOf(m[1]), message: m[2] ? `${m[3]} (${m[2]})` : m[3]! })
          break
        }
      }
      continue
    }
    m = PSALM.exec(line)
    if (m) {
      push({ file: m[2]!, line: +m[3]!, column: +m[4]!, severity: severityOf(m[1]), message: m[5]! })
      continue
    }
    // eslint's stylish form: a file on its own line, its problems indented below it.
    if (ESLINT_FILE.test(line.trim()) && line === line.trimStart()) {
      eslintFile = line.trim()
      continue
    }
    m = ESLINT_ROW.exec(line)
    if (m && eslintFile) {
      push({ file: eslintFile, line: +m[1]!, column: +m[2]!, severity: severityOf(m[3]), message: m[5] ? `${m[4]} (${m[5]})` : m[4]! })
      continue
    }
    if (line.trim() === '') eslintFile = null
    m = GENERIC.exec(line)
    if (m) push({ file: m[1]!, line: +m[2]!, column: m[3] ? +m[3] : 1, severity: severityOf(m[4]), message: m[5]!.trim() })
  }
  return out
}

export interface ProblemsText {
  title: string
  close: string
  none: string
  /** `{n} in {task}` */
  from: string
}

export interface ResolvedProblem extends Problem {
  /** The file on disk; null when it is not there. */
  path: string | null
  /** The task that found it. */
  task: string
}

export class ProblemsPanel {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private problems: ResolvedProblem[] = []

  constructor(
    private text: ProblemsText,
    private readonly go: (p: ResolvedProblem) => void,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'problems-panel'
    this.el.dataset.testid = 'problems-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'problems-title'
    header.append(title, iconButton('close', text.close, () => this.setVisible(false)))
    this.list = document.createElement('div')
    this.list.className = 'problems-list'
    this.el.append(header, this.list)
    this.setText(text)
  }

  setText(text: ProblemsText): void {
    this.text = text
    this.el.querySelector('.problems-title')!.textContent = text.title
    this.draw()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  get all(): readonly ResolvedProblem[] {
    return this.problems
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    this.onVisibility(on)
  }

  /** A task's problems, in place of what it found before. */
  set(task: string, problems: ResolvedProblem[]): void {
    this.problems = [...this.problems.filter((p) => p.task !== task), ...problems]
    this.draw()
  }

  private draw(): void {
    if (this.problems.length === 0) {
      const p = document.createElement('p')
      p.className = 'problems-none'
      p.textContent = this.text.none
      this.list.replaceChildren(p)
      return
    }
    const byFile = new Map<string, ResolvedProblem[]>()
    for (const p of this.problems) {
      const key = p.path ?? p.file
      byFile.set(key, [...(byFile.get(key) ?? []), p])
    }
    this.list.replaceChildren(
      ...[...byFile].map(([file, list]) => {
        const section = document.createElement('section')
        section.className = 'problems-file'
        const h = document.createElement('h3')
        h.textContent = `${file.split(/[\\/]/).pop()} · ${list.length}`
        h.title = file
        section.append(h)
        for (const p of list) {
          const row = document.createElement('button')
          row.type = 'button'
          row.className = `problems-row problems-${p.severity}`
          row.dataset.testid = 'problem'
          const sign = document.createElement('span')
          sign.className = 'problems-sign'
          sign.textContent = p.severity === 'error' ? '●' : p.severity === 'warning' ? '▲' : 'ℹ'
          const msg = document.createElement('span')
          msg.className = 'problems-message'
          msg.textContent = p.message || p.file
          const at = document.createElement('span')
          at.className = 'problems-at'
          at.textContent = `${p.line}:${p.column}`
          row.append(sign, msg, at)
          row.title = `${this.text.from.replace('{task}', p.task)}\n${p.file}:${p.line}:${p.column}`
          row.disabled = p.path === null
          row.addEventListener('click', () => this.go(p))
          section.append(row)
        }
        return section
      }),
    )
  }
}
