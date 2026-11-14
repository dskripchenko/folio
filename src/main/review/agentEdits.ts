// A copy of @dskripchenko/shell-integration's agentEdits.ts (github.com/dskripchenko/shell) until folio takes the package: change both together.
/**
 * The journal of agents' edits, shared by the apps that watch agents (shell,
 * folio): one Claude Code hook (PostToolUse on Edit, Write, MultiEdit,
 * NotebookEdit) appends a line for each edit to `agent-edits.jsonl` in the
 * repository's git folder — the same for its worktrees, never committed, found
 * by either app from the repository alone. A line holds the time, the shell
 * pane the agent runs in (SHELL_PANE_ID, when in shell) and the hook's input
 * (session, tool, folder, file).
 *
 * The hook is one line of POSIX sh (Claude Code runs hooks in bash, Git Bash
 * on Windows) with `git`, `date`, `tr` and `cat`; outside a repository it
 * writes nothing. The same text in the user's and a repository's settings is
 * run once (Claude Code runs identical commands once).
 */

/** The journal's name in the git folder (`git rev-parse --git-common-dir`). */
export const JOURNAL = 'agent-edits.jsonl'
/** What marks the hook among others. */
export const EDITS_MARK = 'agent-edits'
export const EDITS_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit'

export function editsHookCommand(): string {
  return (
    `d=$(git rev-parse --git-common-dir 2>/dev/null) && ` +
    `{ printf '{"t":%s,"pane":"%s","e":' "$(date +%s)" "$(printf %s "\${SHELL_PANE_ID:-}" | tr -cd 'A-Za-z0-9_-')"; cat; printf '}\\n'; } >> "$d/${JOURNAL}" || true # ${EDITS_MARK}`
  )
}

export interface AgentEdit {
  /** As the agent wrote it: absolute, or from `cwd`. */
  path: string
  /** shell's pane the agent ran in; '' outside shell. */
  pane: string
  session: string
  tool: string
  cwd: string
  /** Milliseconds. */
  time: number
}

/** The edits of a journal's text, oldest first; lines that are not an edit are left out. */
export function readEdits(text: string): AgentEdit[] {
  const out: AgentEdit[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const v = JSON.parse(line) as { t?: unknown; pane?: unknown; e?: Record<string, unknown> }
      const e = v.e ?? {}
      const input = (e.tool_input ?? {}) as Record<string, unknown>
      const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
      if (!path) continue
      out.push({
        path,
        pane: typeof v.pane === 'string' ? v.pane : '',
        session: typeof e.session_id === 'string' ? e.session_id : '',
        tool: typeof e.tool_name === 'string' ? e.tool_name : '',
        cwd: typeof e.cwd === 'string' ? e.cwd : '',
        time: typeof v.t === 'number' ? v.t * 1000 : 0,
      })
    } catch {
      // Not an edit (a line cut short, another shape).
    }
  }
  return out
}

/**
 * The journal written again with only what is read back: an edit's input holds
 * the whole text written, so a journal grows fast. Lines as `readEdits` reads them.
 */
export function compactEdits(edits: readonly AgentEdit[]): string {
  return edits.map((e) => JSON.stringify({ t: Math.round(e.time / 1000), pane: e.pane, e: { session_id: e.session, tool_name: e.tool, cwd: e.cwd, tool_input: { file_path: e.path } } })).join('\n') + (edits.length ? '\n' : '')
}
