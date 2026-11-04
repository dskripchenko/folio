/**
 * Line differences between two texts (Myers' O(ND) algorithm): what stays,
 * what was removed from the first, what was added in the second, in order.
 */
export interface DiffLine {
  kind: 'same' | 'del' | 'add'
  text: string
}

export type DiffKind = DiffLine['kind']

/** The edit script turning `a` into `b`, element by element: kept, removed from `a`, added from `b`. */
export function diffArrays<T>(a: readonly T[], b: readonly T[]): DiffKind[] {
  // The common head and tail first: most changes touch a little of a long text.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const middle = myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail))
  return [...Array<DiffKind>(head).fill('same'), ...middle, ...Array<DiffKind>(tail).fill('same')]
}

function myers<T>(a: readonly T[], b: readonly T[]): DiffKind[] {
  const n = a.length
  const m = b.length
  if (n === 0) return Array<DiffKind>(m).fill('add')
  if (m === 0) return Array<DiffKind>(n).fill('del')
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
  const out: DiffKind[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!
    const k = x - y
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1
    const prevX = vd[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      out.push('same')
      x--
      y--
    }
    if (d > 0) out.push(x === prevX ? 'add' : 'del')
    x = prevX
    y = prevY
  }
  return out.reverse()
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n')
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  for (const kind of diffArrays(a, b)) {
    if (kind === 'same') {
      out.push({ kind, text: a[i++]! })
      j++
    } else if (kind === 'del') out.push({ kind, text: a[i++]! })
    else out.push({ kind, text: b[j++]! })
  }
  return out
}
