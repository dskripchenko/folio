import { describe, expect, it } from 'vitest'
import { diffLines } from '../../src/renderer/diff'

const show = (a: string, b: string) => diffLines(a, b).map((l) => ({ same: ' ', del: '-', add: '+' })[l.kind] + l.text)

describe('line differences', () => {
  it('finds what stays, what went and what came', () => {
    expect(show('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([' a', '-b', '+B', ' c', '+d'])
  })
  it('handles empty sides and equal texts', () => {
    expect(show('', 'x\ny')).toEqual(['+x', '+y'])
    expect(show('x\ny', '')).toEqual(['-x', '-y'])
    expect(show('same\n', 'same\n')).toEqual([' same'])
  })
  it('is minimal on a moved block', () => {
    const r = diffLines('1\n2\n3\n4\n5', '1\n3\n4\n5\n2')
    expect(r.filter((l) => l.kind !== 'same')).toHaveLength(2)
  })
  it('rebuilds both texts', () => {
    const a = 'title\n\none\ntwo\nthree\nfour'
    const b = 'title\n\none\n2\nthree\nfive\nfour\nsix'
    const r = diffLines(a, b)
    expect(r.filter((l) => l.kind !== 'add').map((l) => l.text).join('\n')).toBe(a)
    expect(r.filter((l) => l.kind !== 'del').map((l) => l.text).join('\n')).toBe(b)
  })
})
