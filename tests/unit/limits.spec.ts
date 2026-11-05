import { describe, expect, it } from 'vitest'
import { GB, Limits, heapFlag, limitSettings } from '../../src/main/limits'
import type { ProcSample, Sample } from '../../src/main/resources'

const proc = (o: Partial<ProcSample>): ProcSample => ({ pid: 1, kind: 'main', name: 'main', memory: 0, cpu: 0, outside: false, ...o })
const sample = (at: number, memory: number, procs: ProcSample[] = [proc({ memory })]): Sample => ({
  at,
  total: { memory, cpu: 0 },
  outside: { memory: 0, cpu: 0 },
  heap: { used: 0, limit: 0 },
  procs,
})

describe('limits: soft for folio, own for a language server', () => {
  it('lets go first, warns a minute later, takes it back once under', () => {
    const l = new Limits({ softGb: 4, lspGb: 0, heapGb: 0 })
    expect(l.check(sample(0, 3 * GB))).toEqual([])
    expect(l.check(sample(1_000, 5 * GB)).map((a) => a.kind)).toEqual(['relieve'])
    expect(l.check(sample(30_000, 5 * GB))).toEqual([])
    expect(l.check(sample(61_000, 5 * GB)).map((a) => a.kind)).toEqual(['warn'])
    // Once, not every sample.
    expect(l.check(sample(70_000, 5 * GB))).toEqual([])
    // Just under is not under: room is wanted.
    expect(l.check(sample(80_000, 3.9 * GB))).toEqual([])
    expect(l.check(sample(90_000, 3 * GB)).map((a) => a.kind)).toEqual(['clear'])
    expect(l.over).toBe(false)
  })

  it('names the heaviest of folio’s own, not a console’s', () => {
    const l = new Limits({ softGb: 1, lspGb: 0, heapGb: 0 })
    const [a] = l.check(
      sample(0, 2 * GB, [proc({ name: 'main', memory: 0.5 * GB }), proc({ kind: 'lsp', name: 'tsserver', memory: 1.5 * GB }), proc({ kind: 'console', name: 'claude', memory: 9 * GB, outside: true })]),
    )
    expect(a).toMatchObject({ kind: 'relieve', heaviest: { name: 'tsserver' } })
  })

  it('starts a language server over its own limit again, not more than once in five minutes', () => {
    const l = new Limits({ softGb: 0, lspGb: 2, heapGb: 0 })
    const big = proc({ kind: 'lsp', name: 'intelephense', ref: 'a', memory: 3 * GB })
    expect(l.check(sample(0, 3 * GB, [big])).map((a) => a.kind)).toEqual(['restart-lsp'])
    expect(l.check(sample(60_000, 3 * GB, [big]))).toEqual([])
    expect(l.check(sample(301_000, 3 * GB, [big])).map((a) => a.kind)).toEqual(['restart-lsp'])
  })

  it('reads settings within their ranges', () => {
    expect(limitSettings(undefined)).toEqual({ softGb: 4, lspGb: 2, heapGb: 0 })
    expect(limitSettings({ softGb: 0, lspGb: -1, heapGb: 6 })).toEqual({ softGb: 0, lspGb: 2, heapGb: 6 })
    expect(heapFlag(0)).toBeNull()
    expect(heapFlag(1.5)).toBe('--max-old-space-size=1536')
  })
})
