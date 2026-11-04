import { describe, expect, it } from 'vitest'
import { insideConvex } from '../../src/renderer/hoverPreview'

describe('the way from a link into its preview', () => {
  // A link at x 300–360 whose bottom is at 100; the panel below from x 12 to 572, its top at 106.
  const band: [number, number][] = [
    [300, 100],
    [360, 100],
    [572, 106],
    [12, 106],
  ]

  it('holds the gap between them, under the link and widening to the panel', () => {
    expect(insideConvex(band, 330, 103)).toBe(true)
    expect(insideConvex(band, 200, 105)).toBe(true)
    // On an edge.
    expect(insideConvex(band, 300, 100)).toBe(true)
  })

  it('not the text beside the link or anywhere else', () => {
    expect(insideConvex(band, 100, 101)).toBe(false)
    expect(insideConvex(band, 500, 100)).toBe(false)
    expect(insideConvex(band, 330, 90)).toBe(false)
    expect(insideConvex(band, 330, 200)).toBe(false)
  })

  it('either way round; a band with no area holds nothing', () => {
    expect(insideConvex([...band].reverse(), 200, 105)).toBe(true)
    expect(
      insideConvex(
        [
          [0, 0],
          [10, 0],
          [20, 0],
        ],
        5,
        0,
      ),
    ).toBe(false)
  })
})
