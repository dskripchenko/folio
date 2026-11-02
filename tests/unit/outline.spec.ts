import { describe, expect, it } from 'vitest'
import { headingsOf } from '../../src/renderer/outline'

describe('the outline', () => {
  it('headings by level and line; underlined ones; not in code or front matter; their text as read', () => {
    const text = '---\ntitle: x\n# not a heading\n---\n# The **plan**\n\n```\n# code\n```\n\n## [Goals](g.md) and [[Note|notes]]\n\nSetext\n======\n\n- item\n---\n'
    expect(headingsOf(text)).toEqual([
      { level: 1, text: 'The plan', line: 4 },
      { level: 2, text: 'Goals and notes', line: 10 },
      { level: 1, text: 'Setext', line: 12 },
    ])
  })
})
