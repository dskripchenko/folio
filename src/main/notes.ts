/**
 * Daily notes and templates. A daily note is `YYYY-MM-DD.md` in the daily
 * folder; a template is a note whose `{{title}}`, `{{date}}`, `{{time}}` and
 * `{{date:FORMAT}}` are filled in when it is used.
 */
import { existsSync, readdirSync } from 'node:fs'
import { basename } from 'node:path'

const pad = (n: number): string => String(n).padStart(2, '0')

/** A date in a format of `YYYY`, `YY`, `MM`, `M`, `DD`, `D`, `HH`, `mm`, `ss`; anything else as it is. */
export function formatDate(date: Date, format: string): string {
  const parts: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  }
  return format.replace(/YYYY|YY|MM|M|DD|D|HH|mm|ss/g, (t) => parts[t] ?? t)
}

/** A template's text with its fields filled; an unknown `{{field}}` stays as written. */
export function fillTemplate(text: string, fields: { title: string; now: Date }): string {
  return text.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/g, (_m, name: string, format?: string) => {
    if (name === 'title') return fields.title
    if (name === 'time') return formatDate(fields.now, format?.trim() || 'HH:mm')
    return formatDate(fields.now, format?.trim() || 'YYYY-MM-DD')
  })
}

/** A daily note's file name for a day. */
export function dailyName(date: Date): string {
  return `${formatDate(date, 'YYYY-MM-DD')}.md`
}

/** The day a daily note is for, from its file name; null for another note. */
export function dayOf(file: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(basename(file))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The daily note before or after a day (`step` -1 or 1): the nearest one that
 * exists in the folder; null when there is none that way.
 */
export function neighbourDaily(folder: string, day: Date, step: -1 | 1): string | null {
  if (!existsSync(folder)) return null
  const key = formatDate(day, 'YYYY-MM-DD')
  const names = readdirSync(folder)
    .filter((n) => dayOf(n) !== null)
    .map((n) => n.slice(0, 10))
    .sort()
  const found = step < 0 ? names.filter((n) => n < key).at(-1) : names.find((n) => n > key)
  return found ? `${found}.md` : null
}

/** The templates in a folder: its Markdown files, by name. */
export function templatesIn(folder: string): { name: string; file: string }[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
    .map((e) => ({ name: e.name.replace(/\.(md|markdown)$/i, ''), file: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
