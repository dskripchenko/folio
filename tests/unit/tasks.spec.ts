import { describe, expect, it } from 'vitest'
import { tasksOf, toggleTask } from '../../src/main/tasks'

describe('tasks', () => {
  it('open and done ones, their due day in any of its spellings; not in code', () => {
    const text = '# Plan\n\n- [ ] Write the spec 📅 2026-11-10\n- [x] Book a room @2026-11-03\n  1. [ ] Nested due:2026-12-01\n* [ ] Plain\n\n```\n- [ ] in code\n```\n- not a task\n'
    expect(tasksOf(text).map((t) => [t.line, t.text, t.done, t.due])).toEqual([
      [2, 'Write the spec', false, '2026-11-10'],
      [3, 'Book a room', true, '2026-11-03'],
      [4, 'Nested', false, '2026-12-01'],
      [5, 'Plain', false, null],
    ])
  })

  it('checked and unchecked in the text; nothing when the line has changed', () => {
    const text = 'a\n- [ ] One\n  * [X] Two\n'
    expect(toggleTask(text, 1, '- [ ] One', true)).toBe('a\n- [x] One\n  * [X] Two\n')
    expect(toggleTask(text, 2, '  * [X] Two', false)).toBe('a\n- [ ] One\n  * [ ] Two\n')
    expect(toggleTask(text, 1, '- [ ] Other', true)).toBeNull()
  })
})

describe('the tasks panel’s groups', () => {
  it('overdue, today, later, no date; done ones only when asked', async () => {
    const { groupTasks } = await import('../../src/renderer/tasksPanel')
    const t = (text: string, due: string | null, done = false) => ({ rel: 'a.md', path: '/a.md', line: 0, raw: '', text, done, due })
    const groups = groupTasks([t('late', '2026-11-01'), t('now', '2026-11-03'), t('soon', '2026-11-10'), t('any', null), t('old', null, true)], '2026-11-03', false)
    expect(groups.map((g) => [g.key, g.tasks.map((x) => x.text)])).toEqual([['overdue', ['late']], ['today', ['now']], ['later', ['soon']], ['noDate', ['any']]])
    expect(groupTasks([t('old', null, true)], '2026-11-03', true).map((g) => g.key)).toEqual(['done'])
  })
})
