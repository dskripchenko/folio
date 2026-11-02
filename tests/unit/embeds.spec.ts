import { describe, expect, it } from 'vitest'
import { sectionOf } from '../../src/renderer/embeds'

describe('embeds', () => {
  it('a heading’s section: up to the next heading of its level or above, code headings ignored', () => {
    const text = '# Plan\n\nIntro.\n\n## Goals\n\nShip.\n\n```\n# not a heading\n```\n\n### Sub\n\nDetail.\n\n## Risks\n\nNone.\n'
    expect(sectionOf(text, 'Goals')).toBe('## Goals\n\nShip.\n\n```\n# not a heading\n```\n\n### Sub\n\nDetail.')
    expect(sectionOf(text, 'risks')).toBe('## Risks\n\nNone.')
    expect(sectionOf(text, 'Nowhere')).toBeNull()
  })
})
