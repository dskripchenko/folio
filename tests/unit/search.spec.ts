import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { patternOf } from '../../src/common/pattern'
import { hitsIn, searchFiles, type FileHits } from '../../src/main/search'

const p = (q: string, o = {}) => patternOf(q, { caseSensitive: false, wholeWord: false, regex: false, ...o })!

describe('search in files', () => {
  it('lines and previews; a long line cut around the match', () => {
    const { hits } = hitsIn('one\r\ntwo needle\nthree\n' + 'x'.repeat(500) + 'needle' + 'y'.repeat(500), p('needle'))
    expect(hits[0]).toEqual({ line: 2, preview: 'two needle', start: 4, end: 10 })
    expect(hits[1]!.line).toBe(4)
    expect(hits[1]!.preview.startsWith('…') && hits[1]!.preview.endsWith('…')).toBe(true)
    expect(hits[1]!.preview.slice(hits[1]!.start, hits[1]!.end)).toBe('needle')
    expect(hits[1]!.preview.length).toBeLessThan(240)
  })

  it('a limit per file says there is more', () => {
    const r = hitsIn('a\n'.repeat(10), p('a'), 3)
    expect(r.hits.map((h) => h.line)).toEqual([1, 2, 3])
    expect(r.more).toBe(true)
  })

  it('files in order, binary and missing ones passed over, cancel stops', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-search-'))
    writeFileSync(join(dir, 'a.md'), '# A\nthe Needle\n')
    writeFileSync(join(dir, 'b.bin'), Buffer.from([110, 101, 101, 100, 108, 101, 0, 1]))
    writeFileSync(join(dir, 'c.ts'), 'const needle = 1 // needle\n')
    const files = ['a.md', 'b.bin', 'gone.md', 'c.ts'].map((path) => ({ root: 'r', label: 'p', dir, path }))
    const got: FileHits[] = []
    const summary = await searchFiles(files, p('needle'), (b) => got.push(...b), () => false)
    expect(got.map((f) => [f.path, f.hits.length])).toEqual([['a.md', 1], ['c.ts', 2]])
    expect(summary).toEqual({ files: 2, matches: 3, truncated: false, canceled: false })
    const none = await searchFiles(files, p('needle', { caseSensitive: true, wholeWord: true }), () => {}, () => false)
    expect(none.matches).toBe(2)
    expect((await searchFiles(files, p('needle'), () => {}, () => true)).canceled).toBe(true)
  })
})
