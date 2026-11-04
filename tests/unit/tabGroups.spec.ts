import { describe, expect, it } from 'vitest'
import { freeColor, groupAt, groupOf, isTabColor, keepTogether } from '../../src/common/tabGroups'

const row = (...groups: (string | null)[]) => groups.map((group, n) => ({ n, group }))

describe('tab groups', () => {
  it('keeps a group’s tabs together where its first one is', () => {
    expect(keepTogether(row('a', null, 'b', 'a', null, 'b')).map((x) => x.n)).toEqual([0, 3, 1, 2, 5, 4])
  })
  it('joins the group a tab is dropped inside', () => {
    expect(groupAt(row('a', null, 'a'), 1)).toBe('a')
  })
  it('keeps the group beside it, leaves one it moved away from', () => {
    expect(groupAt(row(null, 'a', 'a'), 1)).toBe('a')
    expect(groupAt(row('a', 'a', null), 1)).toBe('a')
    expect(groupAt(row('a', null, 'a'), 2)).toBe(null)
    expect(groupAt(row('a', 'b', null, 'a'), 3)).toBe(null)
    expect(groupAt(row(null, 'a', null), 1)).toBe('a')
    expect(groupAt(row('a', null, 'b'), 1)).toBe(null)
  })
  it('stores only what is a group, and picks a free colour', () => {
    expect(groupOf({ id: 'g', name: 'Work', color: 'red', collapsed: true })).toEqual({ id: 'g', name: 'Work', color: 'red', collapsed: true })
    expect(groupOf({ id: 'g', color: 'magenta' })).toBeNull()
    expect(groupOf({ id: '', color: 'red' })).toBeNull()
    expect(isTabColor('teal')).toBe(true)
    expect(freeColor(['blue', 'green'])).toBe('orange')
  })
})
