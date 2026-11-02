import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filesOf, linkName, mover, resolveWiki, rewriteLinks, wikiLinksIn, wikiTarget } from '../../src/main/wikilinks'

const FILES = ['Index.md', 'notes/Plan.md', 'notes/Ideas.md', 'archive/Plan.md', 'archive/old/Ideas.md', 'media/pic.png']

/** A move applied to the file list, and the text of a note written for it. */
function moveAndRewrite(text: string, note: string, from: string, to: string, files = FILES): string {
  const map = mover(from, to)
  const after = files.map((f) => map(f) ?? f)
  return rewriteLinks(text, note, map(note) ?? note, map, files, after)
}

describe('[[links]] between notes', () => {
  it('splits the heading off a target', () => {
    expect(wikiTarget('Plan#Goals')).toEqual({ name: 'Plan', heading: 'Goals' })
    expect(wikiTarget('Plan')).toEqual({ name: 'Plan', heading: null })
    expect(wikiTarget('#Goals')).toEqual({ name: '', heading: 'Goals' })
  })

  it('resolves a name: the note’s own folder first, then the shortest path', () => {
    expect(resolveWiki('Plan', 'notes/Ideas.md', FILES)).toBe('notes/Plan.md')
    expect(resolveWiki('Plan', 'archive/old/Ideas.md', FILES)).toBe('notes/Plan.md')
    expect(resolveWiki('Ideas', 'Index.md', FILES)).toBe('notes/Ideas.md')
    expect(resolveWiki('plan', 'archive/x.md', FILES)).toBe('archive/Plan.md')
  })

  it('resolves a path, an extension, a picture; nothing for a missing note', () => {
    expect(resolveWiki('archive/Plan', 'Index.md', FILES)).toBe('archive/Plan.md')
    expect(resolveWiki('old/Ideas', 'Index.md', FILES)).toBe('archive/old/Ideas.md')
    expect(resolveWiki('Plan.md', 'notes/Ideas.md', FILES)).toBe('notes/Plan.md')
    expect(resolveWiki('pic.png', 'Index.md', FILES)).toBe('media/pic.png')
    expect(resolveWiki('Nowhere', 'Index.md', FILES)).toBeNull()
  })

  it('names a file by its name when unique, by its path otherwise', () => {
    expect(linkName('Index.md', FILES)).toBe('Index')
    expect(linkName('notes/Plan.md', FILES)).toBe('notes/Plan')
    expect(linkName('media/pic.png', FILES)).toBe('pic.png')
  })

  it('finds links outside code only', () => {
    const text = '[[A]] and ![[b.png|200]]\n\n```\n[[not a link]]\n```\n`[[nor this]]` [[C#H|text]]'
    expect(wikiLinksIn(text).map((l) => [l.embed, l.target, l.alias])).toEqual([
      [false, 'A', null],
      [true, 'b.png', '200'],
      [false, 'C#H', 'text'],
    ])
  })
})

describe('links written anew after a move', () => {
  it('a rename: links to the note follow, with heading and text kept', () => {
    const text = 'See [[Ideas]], [[Ideas#Next|next steps]] and [[Index]].'
    expect(moveAndRewrite(text, 'Index.md', 'notes/Ideas.md', 'notes/Thoughts.md')).toBe('See [[Thoughts]], [[Thoughts#Next|next steps]] and [[Index]].')
  })

  it('a link to a note of the same name elsewhere stays', () => {
    // From archive/, [[Plan]] is archive/Plan.md: renaming notes/Plan.md does not touch it.
    expect(moveAndRewrite('[[Plan]]', 'archive/x.md', 'notes/Plan.md', 'notes/Roadmap.md', [...FILES, 'archive/x.md'])).toBe('[[Plan]]')
  })

  it('a name no longer unique becomes a path, a path stays a path', () => {
    expect(moveAndRewrite('[[Index]]', 'notes/Ideas.md', 'Index.md', 'notes/Plan.md', FILES.filter((f) => f !== 'notes/Plan.md'))).toBe('[[notes/Plan]]')
    expect(moveAndRewrite('[[archive/Plan]]', 'Index.md', 'archive', 'old-archive')).toBe('[[old-archive/Plan]]')
    expect(moveAndRewrite('[[Plan.md]]', 'notes/Ideas.md', 'notes/Plan.md', 'notes/Road.md')).toBe('[[Road.md]]')
  })

  it('relative Markdown links to a moved file get its new path', () => {
    const text = '[plan](notes/Plan.md#goals), ![pic](media/pic.png "title"), [x](<notes/Plan.md>)\n\n[ref]: notes/Plan.md'
    expect(moveAndRewrite(text, 'Index.md', 'notes', 'work/notes')).toBe(
      '[plan](work/notes/Plan.md#goals), ![pic](media/pic.png "title"), [x](<work/notes/Plan.md>)\n\n[ref]: work/notes/Plan.md',
    )
  })

  it('the moved note’s own relative links still reach their files', () => {
    const text = '![pic](../media/pic.png) [home](../Index.md) [web](https://example.com) [top](#top) [[Index]]'
    expect(moveAndRewrite(text, 'notes/Ideas.md', 'notes/Ideas.md', 'archive/old/deep/Ideas.md')).toBe(
      '![pic](../../../media/pic.png) [home](../../../Index.md) [web](https://example.com) [top](#top) [[Index]]',
    )
  })

  it('keeps a link’s encoding, makes spaces safe, leaves code alone', () => {
    expect(moveAndRewrite('[a](My%20Note.md)', 'Index.md', 'My Note.md', 'Our Note.md', [...FILES, 'My Note.md'])).toBe('[a](Our%20Note.md)')
    expect(moveAndRewrite('[a](Plan.md) `[a](Plan.md)`', 'notes/Ideas.md', 'notes/Plan.md', 'notes/Big plan.md')).toBe('[a](Big%20plan.md) `[a](Plan.md)`')
  })
})

describe('the files links are resolved against', () => {
  it('every file of the root, without hidden folders and dependencies', async () => {
    const d = mkdtempSync(join(tmpdir(), 'folio-links-'))
    mkdirSync(join(d, 'a'))
    mkdirSync(join(d, 'node_modules'))
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'a', 'x.md'), '')
    writeFileSync(join(d, 'p.png'), '')
    writeFileSync(join(d, 'node_modules', 'y.md'), '')
    writeFileSync(join(d, '.git', 'z.md'), '')
    expect((await filesOf(d)).sort()).toEqual(['a/x.md', 'p.png'])
  })
})
