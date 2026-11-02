import { describe, expect, it } from 'vitest'
import { tagIndex, tagsOf } from '../../src/main/tags'

describe('tags', () => {
  it('in the text: at the start of a word, a letter in them; not C#, #123, headings, code, links', () => {
    const text = '# Title\n\nDo #todo and #work/urgent, #задача; C# and #123.\n\n`#code` and [x](#anchor), [[Note#Heading]], https://e.com/#frag\n\n```\n#fenced\n```'
    expect(tagsOf(text)).toEqual(['todo', 'work/urgent', 'задача'])
  })

  it('in the front matter: a list, - lines, or words; each tag once, the first spelling kept', () => {
    expect(tagsOf('---\ntitle: x\ntags: [Work, "q4"]\n---\n\n#work and #new')).toEqual(['Work', 'q4', 'new'])
    expect(tagsOf('---\ntags:\n  - alpha\n  - beta\n---\n')).toEqual(['alpha', 'beta'])
    expect(tagsOf('---\ntag: one, two\n---\n')).toEqual(['one', 'two'])
  })

  it('the index: notes by tag, a nested tag counted for its parent', () => {
    const index = tagIndex([
      { rel: 'a.md', text: '#work/urgent' },
      { rel: 'b.md', text: '#work and #home' },
      { rel: 'c.md', text: 'none' },
    ])
    expect(index).toEqual([
      { tag: 'home', notes: ['b.md'] },
      { tag: 'work', notes: ['a.md', 'b.md'] },
      { tag: 'work/urgent', notes: ['a.md'] },
    ])
  })
})
