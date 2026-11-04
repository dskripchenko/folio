import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { AgentEdit } from '../../common/review'
import { writeFileWhileBusy } from '../busy'

/**
 * Claude Code tells folio what it edits (ADR-006, R6): a `PostToolUse` hook
 * in the repository's `.claude/settings.local.json` appends each edit (the
 * hook's input, with the time) to a file of folio's. folio reads the file, the
 * path and the session of each edit, and says who changed a file and when.
 * Nothing else of the settings is touched; the hook is one shell line with no
 * tools beyond `printf`, `date` and `cat` (Claude Code runs hooks in bash,
 * Git Bash on Windows).
 */

/** What marks folio's hook among the others. */
export const MARK = 'folio-review-events'
const MATCHER = 'Edit|Write|MultiEdit|NotebookEdit'

export function settingsFile(repo: string): string {
  return join(repo, '.claude', 'settings.local.json')
}

/** The hook's line: `{"t": seconds, "e": <the hook's input>}` appended to the events file. */
export function hookCommand(events: string): string {
  const path = events.replace(/\\/g, '/').replace(/'/g, `'\\''`)
  return `{ printf '{"t":%s,"e":' "$(date +%s)"; cat; printf '}\\n'; } >> '${path}' # ${MARK}`
}

type Settings = Record<string, unknown> & { hooks?: Record<string, unknown> }
interface Matcher {
  matcher?: string
  hooks?: { type?: string; command?: string }[]
}

const ours = (m: Matcher) => (m.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(MARK))

/** The settings with folio's hook (once, the old one replaced). */
export function withHook(settings: Settings, command: string): Settings {
  const hooks = { ...(settings.hooks ?? {}) }
  const post = (Array.isArray(hooks.PostToolUse) ? (hooks.PostToolUse as Matcher[]) : []).filter((m) => !ours(m))
  post.push({ matcher: MATCHER, hooks: [{ type: 'command', command }] })
  return { ...settings, hooks: { ...hooks, PostToolUse: post } }
}

/** The settings without folio's hook (an empty list or object left out). */
export function withoutHook(settings: Settings): Settings {
  if (!settings.hooks) return settings
  const hooks = { ...settings.hooks }
  const post = (Array.isArray(hooks.PostToolUse) ? (hooks.PostToolUse as Matcher[]) : []).filter((m) => !ours(m))
  if (post.length) hooks.PostToolUse = post
  else delete hooks.PostToolUse
  const out: Settings = { ...settings, hooks }
  if (Object.keys(hooks).length === 0) delete out.hooks
  return out
}

export function hasHook(settings: Settings): boolean {
  return Array.isArray(settings.hooks?.PostToolUse) && (settings.hooks.PostToolUse as Matcher[]).some(ours)
}

/** The repository's local settings (none: empty; not JSON: refused, never overwritten). */
export function readSettings(repo: string): Settings | null {
  const file = settingsFile(repo)
  if (!existsSync(file)) return {}
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Settings) : null
  } catch {
    return null
  }
}

export function writeSettings(repo: string, settings: Settings): void {
  writeFileWhileBusy(settingsFile(repo), JSON.stringify(settings, null, 2) + '\n')
}


/**
 * The edits in an events file, newest last: lines that are not an edit are
 * left out (a hook's input changed shape, a line cut short).
 */
export function readEvents(file: string, limit = 5000): AgentEdit[] {
  let text: string
  try {
    if (statSync(file).size > 64 << 20) return []
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out: AgentEdit[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const v = JSON.parse(line) as { t?: unknown; e?: Record<string, unknown> }
      const e = v.e ?? {}
      const input = (e.tool_input ?? {}) as Record<string, unknown>
      const raw = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
      const cwd = typeof e.cwd === 'string' ? e.cwd : ''
      if (!raw) continue
      out.push({
        path: isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw),
        session: typeof e.session_id === 'string' ? e.session_id : '',
        tool: typeof e.tool_name === 'string' ? e.tool_name : '',
        cwd,
        time: typeof v.t === 'number' ? v.t * 1000 : 0,
      })
    } catch {
      // Not an edit.
    }
  }
  return out.slice(-limit)
}

/**
 * The file kept small: an edit's input holds the whole text written, so once
 * the file grows it is written again with only what folio uses.
 */
export function compactEvents(file: string, edits: readonly AgentEdit[], over = 4 << 20): void {
  try {
    if (statSync(file).size <= over) return
  } catch {
    return
  }
  const lines = edits.map((e) => JSON.stringify({ t: Math.round(e.time / 1000), e: { session_id: e.session, tool_name: e.tool, cwd: e.cwd, tool_input: { file_path: e.path } } }))
  writeFileWhileBusy(file, lines.join('\n') + '\n')
}
