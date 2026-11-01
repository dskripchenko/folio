/**
 * Line differences between two texts (Myers' O(ND) algorithm): what stays,
 * what was removed from the first, what was added in the second, in order.
 */
export interface DiffLine {
  kind: 'same' | 'del' | 'add'
  text: string
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n')
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) break outer
    }
  }
  // Walk the trace back from the end.
  const out: DiffLine[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!
    const k = x - y
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1
    const prevX = vd[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      out.push({ kind: 'same', text: a[x - 1]! })
      x--
      y--
    }
    if (d > 0) {
      if (x === prevX) out.push({ kind: 'add', text: b[y - 1]! })
      else out.push({ kind: 'del', text: a[x - 1]! })
    }
    x = prevX
    y = prevY
  }
  return out.reverse()
}
