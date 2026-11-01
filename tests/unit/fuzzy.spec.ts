import { describe, expect, it } from 'vitest'
import { fuzzyMatch, rank } from '../../src/renderer/fuzzy'

const order = (q: string, paths: string[]) => rank(q, paths, (p) => p).map((r) => r.item)

describe('fuzzy matching of paths', () => {
  it('characters in order, not necessarily together; none out of order', () => {
    expect(fuzzyMatch('rdr', 'src/renderer.ts')).not.toBeNull()
    expect(fuzzyMatch('rdr', 'lib/rd.ts')).toBeNull()
    expect(fuzzyMatch('', 'a')).toEqual({ score: 0, positions: [] })
  })

  it('the name before the folders; the start of the name; the whole name', () => {
    expect(order('readme', ['docs/readme-old/guide.md', 'docs/en/README.md', 'README.md'])).toEqual(['README.md', 'docs/en/README.md', 'docs/readme-old/guide.md'])
    expect(order('main', ['domain/x.ts', 'src/main/main.ts', 'src/main/tree.ts'])[0]).toBe('src/main/main.ts')
  })

  it('word starts: initials find a name', () => {
    expect(order('fi', ['src/profile.ts', 'src/fileIndex.ts'])[0]).toBe('src/fileIndex.ts')
    expect(order('adr', ['docs/internal/adr-001-folio.md', 'src/main/address.ts'])[0]).toBe('docs/internal/adr-001-folio.md')
  })

  it('positions point at the matched characters', () => {
    const m = fuzzyMatch('tree', 'src/main/tree.ts')!
    expect(m.positions.map((p) => 'src/main/tree.ts'[p]).join('')).toBe('tree')
  })

  it('a folder in the query: across the path', () => {
    expect(order('mainmain', ['src/main/main.ts', 'src/renderer/main.css'])).toEqual(['src/main/main.ts'])
  })
})
