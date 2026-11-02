/**
 * Laying out the graph of notes: a force layout (Fruchterman–Reingold) —
 * every pair pushes apart, a link pulls its two notes together, a pull to the
 * centre keeps the unlinked ones near — from a fixed start (a spiral), so the
 * same notes are laid out the same way each time. The work is bounded: the
 * more notes, the fewer rounds.
 */

export interface Point {
  x: number
  y: number
}

/** Positions for `count` nodes linked by `edges`, around (0, 0), about one unit apart. */
export function layout(count: number, edges: readonly (readonly [number, number])[]): Point[] {
  if (count === 0) return []
  // A sunflower spiral: spread evenly, no two in one place.
  const pos: Point[] = Array.from({ length: count }, (_, i) => {
    const r = Math.sqrt(i + 0.5) * 0.9
    const a = i * 2.399963
    return { x: r * Math.cos(a), y: r * Math.sin(a) }
  })
  if (count === 1) return [{ x: 0, y: 0 }]
  const k = 1
  const rounds = Math.max(30, Math.min(300, Math.floor(30_000_000 / (count * count))))
  let temperature = Math.sqrt(count) * 0.5
  const cool = temperature / (rounds + 1)
  const dx = new Float64Array(count)
  const dy = new Float64Array(count)
  // A note with no link has only the push of the others: a stronger pull keeps it by them.
  const linked = new Uint8Array(count)
  for (const [a, b] of edges) {
    linked[a] = 1
    linked[b] = 1
  }
  for (let round = 0; round < rounds; round++) {
    dx.fill(0)
    dy.fill(0)
    for (let i = 0; i < count; i++) {
      const p = pos[i]!
      for (let j = i + 1; j < count; j++) {
        const q = pos[j]!
        let x = p.x - q.x
        let y = p.y - q.y
        let d2 = x * x + y * y
        if (d2 < 1e-6) {
          x = 0.01 * ((i % 7) - 3)
          y = 0.01 * ((j % 5) - 2)
          d2 = x * x + y * y
        }
        const f = (k * k) / d2
        dx[i]! += x * f
        dy[i]! += y * f
        dx[j]! -= x * f
        dy[j]! -= y * f
      }
    }
    for (const [a, b] of edges) {
      const p = pos[a]!
      const q = pos[b]!
      const x = p.x - q.x
      const y = p.y - q.y
      const d = Math.sqrt(x * x + y * y) || 1e-3
      const f = d / k
      dx[a]! -= x * f
      dy[a]! -= y * f
      dx[b]! += x * f
      dy[b]! += y * f
    }
    for (let i = 0; i < count; i++) {
      const p = pos[i]!
      // A pull to the centre, so parts with no link between them stay together.
      const pull = (linked[i] ? 0.02 : 0.12) * Math.sqrt(count)
      dx[i]! -= p.x * pull
      dy[i]! -= p.y * pull
      const len = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 1
      const step = Math.min(len, temperature)
      p.x += (dx[i]! / len) * step
      p.y += (dy[i]! / len) * step
    }
    temperature -= cool
  }
  return pos
}

/** The nodes within `depth` links of a node (itself included). */
export function neighbourhood(center: number, edges: readonly (readonly [number, number])[], depth: number): Set<number> {
  const near = new Set([center])
  let frontier = [center]
  for (let d = 0; d < depth; d++) {
    const next: number[] = []
    for (const [a, b] of edges) {
      for (const [from, to] of [[a, b], [b, a]] as const) {
        if (frontier.includes(from) && !near.has(to)) {
          near.add(to)
          next.push(to)
        }
      }
    }
    frontier = next
  }
  return near
}
