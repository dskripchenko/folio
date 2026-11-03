import { describe, expect, it } from 'vitest'
import { hunkAt, hunksOf, marksOf, revertOf } from '../../src/renderer/gitMarks'

/** A minimal document for the offsets. */
function doc(text: string) {
  const lines = text.split('\n')
  const starts: number[] = []
  let at = 0
  for (const l of lines) {
    starts.push(at)
    at += l.length + 1
  }
  return {
    lineCount: lines.length,
    length: text.length,
    lineStart: (i: number) => starts[i]!,
    lineEnd: (i: number) => starts[i]! + lines[i]!.length,
  }
}
const apply = (text: string, c: { from: number; to: number; insert: string }) => text.slice(0, c.from) + c.insert + text.slice(c.to)

describe('a file against its last commit', () => {
  const committed = 'a\nb\nc\nd\ne\n'
  it('added, changed and deleted lines as marks', () => {
    const now = 'a\nB\nc\nnew\nd\n'
    const hunks = hunksOf(committed, now)
    expect(marksOf(hunks)).toEqual([
      { line: 1, kind: 'modified' },
      { line: 3, kind: 'added' },
      { line: 4, kind: 'deleted' },
    ])
    expect(hunkAt(hunks, 1)?.old).toEqual(['b'])
    expect(hunksOf(committed.replace(/\n/g, '\r\n'), committed)).toEqual([])
  })

  it('each run taken back gives the committed text again', () => {
    const cases = ['a\nB\nc\nd\ne\n', 'x\na\nb\nc\nd\ne\n', 'a\nb\nc\nd\ne\nz\n', 'b\nc\nd\ne\n', 'a\nb\nc\nd\n', 'a\nc\nd\ne\n', 'a\nB\nC\nd\ne\nf\n']
    for (const now of cases) {
      let text = now
      // Back one run at a time, from the last (the earlier ones' places do not move).
      for (const h of hunksOf(committed, now).reverse()) text = apply(text, revertOf(doc(text), h))
      expect(text, JSON.stringify(now)).toBe(committed)
    }
  })
})
