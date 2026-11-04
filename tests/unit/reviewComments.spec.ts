import { describe, expect, it } from 'vitest'
import { anchorOf, compose, contextOf, excerptOf } from '../../src/renderer/review/comments'
import { fileDiff } from '../../src/renderer/review/rows'

describe('review comments', () => {
  const lines = ['a', 'b', 'x', 'c', 'b', 'x']
  it('found again by their lines, the nearest to where they were made', () => {
    expect(anchorOf({ line: 6, excerpt: ['c', 'b', 'x'] }, lines)).toBe(5)
    expect(anchorOf({ line: 3, excerpt: ['x'] }, lines)).toBe(2)
    expect(anchorOf({ line: 6, excerpt: ['x'] }, lines)).toBe(5)
    // Moved down by two lines added above: still found.
    expect(anchorOf({ line: 3, excerpt: ['a', 'b', 'x'] }, ['new', 'new', ...lines])).toBe(4)
    expect(anchorOf({ line: 3, excerpt: ['gone'] }, lines)).toBe(-1)
    expect(excerptOf(lines, 1)).toEqual(['a', 'b'])
  })
  it('the rows around a line, and the text for the agent', () => {
    const d = fileDiff('one\ntwo\nthree\n', 'one\nTWO\nthree\n')
    expect(contextOf(d, 1, 1)).toEqual([' one', '-two', '+TWO'])
    const text = compose('Review comments — Changes · app:', [
      { id: '1', path: 'src/a.ts', side: 'b', line: 2, excerpt: ['TWO'], context: ['-two', '+TWO'], text: 'Keep it lower case.\nIt is a constant elsewhere.', time: 0 },
    ])
    expect(text).toBe('Review comments — Changes · app:\n\n1. src/a.ts:2\n```diff\n-two\n+TWO\n```\nKeep it lower case.\nIt is a constant elsewhere.\n')
  })
})
