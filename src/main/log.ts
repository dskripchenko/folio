/**
 * folio's own log (ADR-007, M2): one file a day in folio-data/logs, a JSON
 * object a line. Lines are buffered and written once a second (and when
 * leaving); files older than the days kept are removed at start and once a
 * day; a day's file stops at a size and goes on in `.1`, `.2`... Nothing of a
 * document's text, no tokens: what happened, where, how long, how much.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type Level = 'debug' | 'info' | 'warn' | 'error'

export interface LogLine {
  ts: string
  level: Level
  proc: string
  area: string
  msg: string
  data?: unknown
}

export interface LogOptions {
  /** Days kept, today included. */
  days?: number
  /** A day's file stops at this size and goes on in the next part. */
  maxBytes?: number
  /** Lines waiting at most; more are dropped and counted. */
  maxPending?: number
  /** Written every so often (ms); 0 — only by `flush()`. */
  every?: number
  now?: () => Date
  /** Other folders whose files go with the log's days (crash dumps). */
  alsoPrune?: readonly string[]
}

const DAY = /^folio-(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.log$/
export const LOG_DAYS = 5
export const LOG_DAYS_RANGE = [1, 30] as const

/** A day as the files name it, in local time. */
export function dayOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Days kept, within the range (an odd value: the default). */
export function logDays(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : LOG_DAYS
  return Math.min(LOG_DAYS_RANGE[1], Math.max(LOG_DAYS_RANGE[0], n))
}

/** Something thrown, as a log can keep it. */
export function errorData(e: unknown): { name?: string; message: string; stack?: string } {
  if (e instanceof Error) return { name: e.name, message: e.message, ...(e.stack ? { stack: e.stack.split('\n').slice(0, 12).join('\n') } : {}) }
  return { message: String(e) }
}

export class Log {
  private pending: string[] = []
  private dropped = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private part = 0
  private partDay = ''
  private prunedDay = ''
  private days: number
  private readonly maxBytes: number
  private readonly maxPending: number
  private readonly now: () => Date
  private readonly alsoPrune: readonly string[]

  constructor(
    readonly dir: string,
    o: LogOptions = {},
  ) {
    this.days = logDays(o.days)
    this.maxBytes = o.maxBytes ?? 50 * 1024 * 1024
    this.maxPending = o.maxPending ?? 5000
    this.now = o.now ?? (() => new Date())
    this.alsoPrune = o.alsoPrune ?? []
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // A log is never why folio cannot start.
    }
    this.prune()
    const every = o.every ?? 1000
    if (every > 0) {
      this.timer = setInterval(() => this.flush(), every)
      this.timer.unref?.()
    }
  }

  setDays(days: number): void {
    this.days = logDays(days)
    this.prunedDay = ''
    this.prune()
  }

  get keptDays(): number {
    return this.days
  }

  write(level: Level, area: string, msg: string, data?: unknown, proc = 'main'): void {
    if (this.pending.length >= this.maxPending) {
      // Debug goes first; past that, lines are counted, not kept.
      if (level === 'debug') return void this.dropped++
      const i = this.pending.findIndex((l) => l.includes('"level":"debug"'))
      if (i >= 0) this.pending.splice(i, 1)
      else return void this.dropped++
    }
    const line: LogLine = { ts: this.now().toISOString(), level, proc, area, msg, ...(data === undefined ? {} : { data }) }
    let text: string
    try {
      text = JSON.stringify(line)
    } catch {
      text = JSON.stringify({ ...line, data: String(data) })
    }
    this.pending.push(text)
  }

  debug(area: string, msg: string, data?: unknown): void {
    this.write('debug', area, msg, data)
  }
  info(area: string, msg: string, data?: unknown): void {
    this.write('info', area, msg, data)
  }
  warn(area: string, msg: string, data?: unknown): void {
    this.write('warn', area, msg, data)
  }
  error(area: string, msg: string, data?: unknown): void {
    this.write('error', area, msg, data)
  }

  /** The file lines go to now: today's, its part past the size. */
  file(): string {
    const day = dayOf(this.now())
    if (day !== this.partDay) {
      this.partDay = day
      this.part = 0
      // Started again the same day: on in its last part.
      try {
        for (const name of readdirSync(this.dir)) {
          const m = name.match(/^folio-(\d{4}-\d{2}-\d{2})\.(\d+)\.log$/)
          if (m && m[1] === day) this.part = Math.max(this.part, Number(m[2]))
        }
      } catch {
        // No folder: written below makes it.
      }
    }
    const name = (part: number) => join(this.dir, part === 0 ? `folio-${day}.log` : `folio-${day}.${part}.log`)
    try {
      while (statSync(name(this.part)).size >= this.maxBytes) this.part++
    } catch {
      // Not there yet.
    }
    return name(this.part)
  }

  flush(): void {
    if (this.dropped > 0) {
      const n = this.dropped
      this.dropped = 0
      this.pending.push(JSON.stringify({ ts: this.now().toISOString(), level: 'warn', proc: 'main', area: 'log', msg: 'lines dropped', data: { n } }))
    }
    if (this.pending.length === 0) return
    const text = this.pending.join('\n') + '\n'
    this.pending = []
    try {
      appendFileSync(this.file(), text)
    } catch {
      // A full disk, a folder gone: the lines are lost, folio goes on.
    }
    this.prune()
  }

  /** Files of days past those kept removed (once a day), in the log's folder and the others given. */
  prune(): void {
    const today = dayOf(this.now())
    if (this.prunedDay === today) return
    this.prunedDay = today
    const oldest = new Date(this.now())
    oldest.setDate(oldest.getDate() - (this.days - 1))
    const keep = dayOf(oldest)
    try {
      for (const name of readdirSync(this.dir)) {
        const m = name.match(DAY)
        if (m && m[1]! < keep) rmSync(join(this.dir, name), { force: true })
      }
    } catch {
      // Nothing to remove.
    }
    const before = new Date(`${keep}T00:00:00`).getTime()
    for (const dir of this.alsoPrune) {
      try {
        for (const name of readdirSync(dir, { recursive: true }) as string[]) {
          const path = join(dir, name)
          const st = statSync(path)
          if (st.isFile() && st.mtimeMs < before) rmSync(path, { force: true })
        }
      } catch {
        // No such folder.
      }
    }
  }

  /**
   * How the run before this one ended, from the newest file: `crashed` when its
   * last start has no quit after it (killed by the system, fallen), `clean`
   * when it quit or started again on purpose, `unknown` with no log. Asked
   * before this run writes its own start.
   */
  lastRun(): { ended: 'clean' | 'crashed' | 'unknown'; at: string | null } {
    for (const file of this.files().slice(0, 2)) {
      let lines: string[]
      try {
        lines = readFileSync(file, 'utf8').trimEnd().split('\n')
      } catch {
        continue
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i]!
        if (!l.includes('"area":"app"')) continue
        let line: LogLine
        try {
          line = JSON.parse(l) as LogLine
        } catch {
          continue
        }
        if (line.msg === 'quit' || line.msg === 'starting again with a heap limit') return { ended: 'clean', at: line.ts }
        if (line.msg === 'start') return { ended: 'crashed', at: line.ts }
      }
    }
    return { ended: 'unknown', at: null }
  }

  /** The files there are, newest first (a day's later parts before its first). */
  files(): string[] {
    const key = (n: string) => {
      const m = n.match(/^folio-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/)!
      return `${m[1]}#${String(Number(m[2] ?? 0)).padStart(4, '0')}`
    }
    try {
      return readdirSync(this.dir)
        .filter((n) => DAY.test(n))
        .sort((a, b) => key(b).localeCompare(key(a)))
        .map((n) => join(this.dir, n))
    } catch {
      return []
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.flush()
  }
}
