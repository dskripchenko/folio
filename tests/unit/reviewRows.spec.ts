import { describe, expect, it } from 'vitest'
import { blocksOf, fileDiff, markRanges } from '../../src/renderer/review/rows'

const lines = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `line ${i + from}\n`).join('')

describe('review rows', () => {
  it('a change with context, the long unchanged stretches folded', () => {
    const before = lines(30)
    const after = before.replace('line 15\n', 'line fifteen\n')
    const d = fileDiff(before, after)
    expect(d.hunks).toEqual([{ a: 14, aEnd: 15, b: 14, bEnd: 15 }])
    const blocks = blocksOf(d)
    expect(blocks.map((b) => b.kind)).toEqual(['gap', 'hunk', 'rows', 'gap'])
    const third = blocks[2]!
    const rows = third.kind === 'rows' ? third.rows : []
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same', 'same', 'del', 'add', 'same', 'same', 'same'])
    expect(blocks[0]).toEqual({ kind: 'gap', from: 0, to: 11 })
    // A gap opened: its lines shown.
    expect(blocksOf(d, 3, new Set([0])).map((b) => b.kind)).toEqual(['hunk', 'rows', 'gap'])
  })
  it('changed words marked in a line edited, not in lines that are different', () => {
    const d = fileDiff('const total = price * count\nfoo\n', 'const total = price * amount\nsomething else entirely\n')
    const del = d.rows.filter((r) => r.kind === 'del')
    const add = d.rows.filter((r) => r.kind === 'add')
    expect(del[0]!.words).toEqual([[22, 27]])
    expect(add[0]!.words).toEqual([[22, 28]])
    expect(add[1]!.words).toBeUndefined()
  })
  it('a new file and a deleted one: all lines one run', () => {
    expect(fileDiff(null, 'a\nb\n').rows.map((r) => r.kind)).toEqual(['add', 'add'])
    expect(fileDiff('a\n', null).hunks).toEqual([{ a: 0, aEnd: 1, b: 0, bEnd: 0 }])
  })
  it('ranges marked in highlighted HTML, around its tags and entities', () => {
    const html = '<span class="k">const</span> a &lt; b'
    expect(markRanges(html, [[3, 8]], 'w')).toBe('<span class="k">con<span class="w">st</span></span><span class="w"> a </span>&lt; b')
    expect(markRanges('x &amp; y', [[2, 3]], 'w')).toBe('x <span class="w">&amp;</span> y')
  })
})
