import { describe, expect, it } from 'vitest'
import { layout, neighbourhood } from '../../src/renderer/graphLayout'

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('the graph of notes', () => {
  it('linked notes lie closer than unlinked ones; no two in one place; the same each time', () => {
    // Two triangles joined by one link.
    const edges: [number, number][] = [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [2, 3]]
    const pos = layout(6, edges)
    const linked = edges.map(([a, b]) => dist(pos[a]!, pos[b]!))
    const apart = dist(pos[0]!, pos[4]!)
    expect(Math.max(...linked)).toBeLessThan(apart)
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) expect(dist(pos[i]!, pos[j]!)).toBeGreaterThan(0.2)
    expect(layout(6, edges)).toEqual(pos)
  })

  it('unlinked notes stay near the rest; empty and single graphs', () => {
    const pos = layout(30, [[0, 1]])
    expect(Math.max(...pos.map((p) => Math.hypot(p.x, p.y)))).toBeLessThan(20)
    expect(layout(0, [])).toEqual([])
    expect(layout(1, [])).toEqual([{ x: 0, y: 0 }])
  })

  it('a thousand notes: laid out quickly', () => {
    const edges: [number, number][] = Array.from({ length: 1500 }, (_, i) => [i % 1000, (i * 7 + 3) % 1000])
    const start = performance.now()
    layout(1000, edges)
    expect(performance.now() - start).toBeLessThan(3000)
  })

  it('a note’s neighbourhood, to a depth', () => {
    const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [5, 6]]
    expect([...neighbourhood(1, edges, 1)].sort()).toEqual([0, 1, 2])
    expect([...neighbourhood(0, edges, 2)].sort()).toEqual([0, 1, 2])
    expect([...neighbourhood(5, edges, 2)].sort()).toEqual([5, 6])
  })
})
