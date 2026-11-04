import { describe, expect, it } from 'vitest'
import { discardHunk, findHunk, hunkState, hunksOf, splitLines, stageHunk, unstageHunk } from '../../src/common/hunks'

const head = 'a\nb\nc\nd\ne\nf\n'
// Two runs: b changed, e removed and g added at the end.
const work = 'a\nB\nc\nd\nf\ng\n'
const runs = () => hunksOf(splitLines(head), splitLines(work))

describe('hunks', () => {
  it('keeps line ends, CRLF and a last line without one', () => {
    expect(splitLines('x\r\ny\nz')).toEqual(['x\r\n', 'y\n', 'z'])
    expect(splitLines('x\r\ny\nz').join('')).toBe('x\r\ny\nz')
    expect(splitLines('')).toEqual([])
  })
  it('finds the runs of changed lines', () => {
    expect(runs()).toEqual([
      { a: 1, aEnd: 2, b: 1, bEnd: 2 },
      { a: 4, aEnd: 5, b: 4, bEnd: 4 },
      { a: 6, aEnd: 6, b: 5, bEnd: 6 },
    ])
  })
  it('stages one run, the rest left as it was', () => {
    const [first, second] = runs()
    const index = stageHunk(head, work, first!)
    expect(index).toBe('a\nB\nc\nd\ne\nf\n')
    expect(hunkState(head, index, work, first!)).toBe('staged')
    expect(hunkState(head, index, work, second!)).toBe('unstaged')
    // A removal staged too.
    expect(stageHunk(index, work, second!)).toBe('a\nB\nc\nd\nf\n')
  })
  it('takes a staged run out of the index', () => {
    const all = work
    const [first] = runs()
    expect(unstageHunk(head, all, first!)).toBe('a\nb\nc\nd\nf\ng\n')
  })
  it('throws a run away from the working file', () => {
    const [, second, third] = runs()
    expect(discardHunk(head, work, second!)).toBe('a\nB\nc\nd\ne\nf\ng\n')
    expect(discardHunk(head, work, third!)).toBe('a\nB\nc\nd\nf\n')
  })
  it('a part staged and a part not: partly', () => {
    const h = 'x\n'
    const w = 'one\ntwo\n'
    const [run] = hunksOf(splitLines(h), splitLines(w))
    expect(hunkState(h, 'one\nx\n', w, run!)).toBe('partly')
  })
  it('finds a run again only where the texts did not change', () => {
    const [first] = runs()
    expect(findHunk(head, work, { ...first!, lines: { before: ['b\n'], after: ['B\n'] } })).toEqual(first)
    expect(findHunk(head, 'a\nX\nc\nd\nf\ng\n', { ...first!, lines: { before: ['b\n'], after: ['B\n'] } })).toBeNull()
  })
})
