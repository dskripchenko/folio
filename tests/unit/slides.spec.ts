import { describe, expect, it } from 'vitest'
import { slidesOf } from '../../src/renderer/slides'

describe('slides', () => {
  it('split on --- after an empty line; not in code, front matter or under a heading', () => {
    const text = '---\ntitle: Talk\n---\n# One\n\nText\n\n---\n\n## Two\nSetext\n---\n\n```\n\n---\n```\n\n---\n\n---\n# Three\n'
    expect(slidesOf(text)).toEqual(['# One\n\nText', '## Two\nSetext\n---\n\n```\n\n---\n```', '# Three'])
  })
  it('a note without breaks is one slide; an empty one none', () => {
    expect(slidesOf('# Only\r\n\r\ntext')).toEqual(['# Only\n\ntext'])
    expect(slidesOf('  \n')).toEqual([])
  })
})
