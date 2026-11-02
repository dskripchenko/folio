import { describe, expect, it } from 'vitest'
import { countText, lineCol } from '../../src/renderer/statusBar'

describe('the status line', () => {
  it('counts words and characters of the text, not of its markup, front matter or code', () => {
    const text = '---\ntitle: Plan\n---\n\n# The plan\n\nShip **it** — see [[Roadmap|the road]] and [docs](a.md).\n\n```js\nconst x = 1\n```\n'
    expect(countText(text).words).toBe(9)
    expect(countText('Привет, мир! 2026 год.').words).toBe(4)
    expect(countText('').words).toBe(0)
  })

  it('the line and column of a place', () => {
    expect(lineCol('ab\ncde\nf', 5)).toEqual({ line: 2, col: 3 })
    expect(lineCol('ab', 0)).toEqual({ line: 1, col: 1 })
  })
})
