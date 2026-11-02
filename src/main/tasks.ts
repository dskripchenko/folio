/**
 * Tasks: the `- [ ]` and `- [x]` lines of a root's notes, outside code, with
 * the day they are due when one is written (`📅 2026-11-10`, `@2026-11-10`,
 * `due:2026-11-10`); a task checked or unchecked in its file.
 */
import { codeRanges } from './wikilinks'

export interface Task {
  /** Its line in the note (from 0), and the line as written. */
  line: number
  raw: string
  text: string
  done: boolean
  /** `YYYY-MM-DD`, or null. */
  due: string | null
}

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/
const DUE = /(?:📅\s*|@|due:\s*)(\d{4}-\d{2}-\d{2})\b/

/** A note's tasks. */
export function tasksOf(text: string): Task[] {
  const code = codeRanges(text)
  const out: Task[] = []
  let at = 0
  text.split('\n').forEach((raw, line) => {
    const start = at
    at += raw.length + 1
    const m = TASK.exec(raw)
    if (!m || code.some(([a, b]) => start >= a && start < b)) return
    const body = m[4]!
    const due = DUE.exec(body)?.[1] ?? null
    out.push({ line, raw, text: body.replace(DUE, '').replace(/\s+/g, ' ').trim(), done: m[2] !== ' ', due })
  })
  return out
}

/**
 * The note's text with a task checked or unchecked; null when its line is not
 * the one the window saw (the note changed meanwhile).
 */
export function toggleTask(text: string, line: number, raw: string, done: boolean): string | null {
  const lines = text.split('\n')
  if (lines[line] !== raw) return null
  const m = TASK.exec(raw)
  if (!m) return null
  lines[line] = `${m[1]}${done ? 'x' : ' '}${m[3]}${m[4]}`
  return lines.join('\n')
}
