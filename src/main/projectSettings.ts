import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A project's own settings (ADR-002), `.folio/settings.json` at its top —
 * written by hand, committed with the project if its people want: its kind,
 * its indentation, tasks of its own, formatting on save. Anything not
 * understood is left out, not an error.
 */
export interface ProjectSettings {
  kind?: 'notes' | 'code'
  /** What Tab inserts (`"\t"` or spaces) and a tab's width; over `.editorconfig`. */
  indentUnit?: string
  tabSize?: number
  /** Tasks besides the ones found (package.json scripts, Makefile targets…). */
  tasks?: { name: string; command: string }[]
  formatOnSave?: boolean
  /** The formatter: one folio knows (`prettier`, `gofmt`…), `lsp` (the language server), or a command reading the text on stdin and writing it on stdout. */
  formatter?: string
  /** Language servers by language: a command and its arguments, or false for none (ADR-003). */
  lsp?: Record<string, string[] | false>
}

export function readProjectSettings(dir: string): ProjectSettings {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(dir, '.folio', 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: ProjectSettings = {}
  if (r.kind === 'notes' || r.kind === 'code') out.kind = r.kind
  if (typeof r.indentUnit === 'string' && /^(\t| {1,8})$/.test(r.indentUnit)) out.indentUnit = r.indentUnit
  if (typeof r.tabSize === 'number' && r.tabSize >= 1 && r.tabSize <= 16) out.tabSize = Math.floor(r.tabSize)
  if (Array.isArray(r.tasks))
    out.tasks = r.tasks.filter(
      (t): t is { name: string; command: string } =>
        !!t && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string' && typeof (t as { command?: unknown }).command === 'string',
    )
  if (typeof r.formatOnSave === 'boolean') out.formatOnSave = r.formatOnSave
  if (typeof r.formatter === 'string' && r.formatter.trim()) out.formatter = r.formatter.trim()
  if (r.lsp && typeof r.lsp === 'object' && !Array.isArray(r.lsp)) {
    const lsp: Record<string, string[] | false> = {}
    for (const [language, v] of Object.entries(r.lsp as Record<string, unknown>)) {
      if (v === false) lsp[language] = false
      else if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) lsp[language] = v as string[]
    }
    out.lsp = lsp
  }
  return out
}
