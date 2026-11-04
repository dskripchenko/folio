/**
 * folio's MCP server (ADR-006, R7): the tools an agent sees. Shared by the
 * server in the app and by the bridge an agent starts (which answers with
 * them on its own while folio is not running).
 */

export const MCP_NAME = 'folio'
/** The protocol version answered when the agent names none folio knows. */
export const MCP_PROTOCOL = '2025-06-18'
export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

export interface McpTool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

const repo = { type: 'string', description: 'An absolute path in the repository (its folder, or any file or folder in it).' }

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'show_changes',
    description:
      'Show changes to the person in folio\'s review and wait until they answer: "approved", or "changes requested" with their comments on lines. ' +
      'Use it when the work is ready to be looked at. Waits as long as the person takes; their comments come back with the file, line and the rows they are about.',
    inputSchema: {
      type: 'object',
      properties: {
        repo,
        kind: {
          type: 'string',
          enum: ['working', 'commit', 'range', 'worktree', 'since'],
          description:
            'What to show: "working" — uncommitted changes (the default); "commit" — one commit (rev); "range" — from..to; "worktree" — a worktree against its base; "since" — what changed since the person last looked.',
        },
        rev: { type: 'string', description: 'The commit, for "commit".' },
        from: { type: 'string', description: 'The start of a range (not included), for "range".' },
        to: { type: 'string', description: 'The end of a range, for "range" (default HEAD).' },
        base: { type: 'string', description: 'What a worktree is compared with, for "worktree" (default: the main copy\'s branch).' },
        message: { type: 'string', description: 'A line for the person: what was done and what to look at.' },
      },
      required: ['repo'],
    },
  },
  {
    name: 'get_review_comments',
    description:
      'The person\'s comments on lines in folio\'s review of a repository that were not given to an agent yet, each with its file, line and the rows around it. Those returned are marked as given.',
    inputSchema: {
      type: 'object',
      properties: { repo, all: { type: 'boolean', description: 'Also the comments given before (they stay marked).' } },
      required: ['repo'],
    },
  },
  {
    name: 'open_file',
    description: 'Open a file in folio for the person, at a line.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file\'s absolute path.' },
        line: { type: 'number', description: 'The line, from 1.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_worktrees',
    description: 'The repository\'s worktrees: path, branch, files changed and not committed, commits ahead of and behind the base.',
    inputSchema: { type: 'object', properties: { repo }, required: ['repo'] },
  },
]

/** The person's answer to `show_changes`. */
export interface McpAnswer {
  decision: 'approved' | 'changes' | 'closed'
  /** The comments, as one text (with "changes"). */
  text?: string
}

/** The text an agent gets for an answer. */
export function answerText(a: McpAnswer): string {
  if (a.decision === 'approved') return 'Approved: the person looked at the changes and accepted them.'
  if (a.decision === 'closed') return 'The person closed the review without an answer.'
  return `Changes requested.\n\n${a.text ?? ''}`.trimEnd()
}
