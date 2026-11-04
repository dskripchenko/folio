import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compactEvents, hasHook, hookCommand, readEvents, withHook, withoutHook } from '../../src/main/review/hooks'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-hooks-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('Claude Code hooks', () => {
  it('added once beside the others, and taken out leaving them', () => {
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }
    const settings = { permissions: { allow: ['Bash(ls)'] }, hooks: { PostToolUse: [other], Stop: [{ hooks: [] }] } }
    const once = withHook(withHook(settings, hookCommand('/tmp/e.jsonl')), hookCommand('/tmp/e.jsonl'))
    expect((once.hooks!.PostToolUse as unknown[]).length).toBe(2)
    expect(hasHook(once)).toBe(true)
    expect(once.permissions).toEqual({ allow: ['Bash(ls)'] })
    expect(withoutHook(once)).toEqual(settings)
    expect(withoutHook(withHook({}, hookCommand('/x')))).toEqual({})
  })

  it.skipIf(process.platform === 'win32')('its line appends an edit with the time; folio reads the path and the session', () => {
    const events = join(dir, "it's events.jsonl")
    const input = { session_id: 'abc123', cwd: '/repo', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' } }
    for (let i = 0; i < 2; i++) execFileSync('bash', ['-c', hookCommand(events)], { input: JSON.stringify(input) })
    const edits = readEvents(events)
    expect(edits).toHaveLength(2)
    expect(edits[0]).toMatchObject({ path: join('/repo', 'src', 'a.ts'), session: 'abc123', tool: 'Edit', cwd: '/repo' })
    expect(Math.abs(edits[0]!.time - Date.now())).toBeLessThan(60_000)
  })

  it('lines that are not edits left out; a big file written again small', () => {
    const file = join(dir, 'e.jsonl')
    const big = 'x'.repeat(10_000)
    const line = (n: number) => JSON.stringify({ t: n, e: { session_id: 's', tool_name: 'Write', cwd: '/r', tool_input: { file_path: `/r/f${n}.ts`, content: big } } })
    writeFileSync(file, ['garbage', '{"t":1}', ...Array.from({ length: 50 }, (_, i) => line(i))].join('\n') + '\n')
    const edits = readEvents(file)
    expect(edits).toHaveLength(50)
    compactEvents(file, edits, 1000)
    expect(statSync(file).size).toBeLessThan(10_000)
    expect(readEvents(file).map((e) => e.path)).toEqual(edits.map((e) => e.path))
    expect(readFileSync(file, 'utf8')).not.toContain('xxxx')
  })
})
