import { describe, expect, it } from 'vitest'
import { buildSample, consoleName, parsePs, parseWin, treeOf, type AppMetric, type Owned } from '../../src/main/resources'

const ps = `
  100     1 204800  12.5 /Applications/folio.app/Contents/MacOS/folio
  101   100 102400   3.0 folio Helper (Renderer)
  102   100  51200   1,5 folio Helper (GPU)
  200   100 1048576  40.0 node
  201   200 10240    1.0 node
  300   100  4096    0.0 -zsh
  301   300 819200  90.0 claude
  302   301 20480    5.0 node
  999     1  1000    0.0 launchd-thing
`
const metrics: AppMetric[] = [
  { pid: 100, type: 'Browser', cpu: { percentCPUUsage: 10 }, memory: { workingSetSize: 200 * 1024 } },
  { pid: 101, type: 'Tab', cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 100 * 1024 } },
  { pid: 102, type: 'GPU', cpu: { percentCPUUsage: 1.5 }, memory: { workingSetSize: 50 * 1024 } },
]
const MB = 1024 * 1024

describe('resources: what folio takes, by process', () => {
  it('reads ps and Windows’ list', () => {
    const rows = parsePs(ps)
    expect(rows).toHaveLength(9)
    expect(rows[2]).toEqual({ pid: 102, ppid: 100, rss: 50 * MB, cpu: 1.5, comm: 'folio Helper (GPU)' })
    expect(parseWin('4 0 8192 0 System\r\n4242 100 1048576 12 node.exe\r\n')).toEqual([
      { pid: 4, ppid: 0, rss: 8192, cpu: 0, comm: 'System' },
      { pid: 4242, ppid: 100, rss: 1048576, cpu: 12, comm: 'node.exe' },
    ])
  })

  it('takes a process with all below it', () => {
    expect(treeOf(parsePs(ps), 300).map((p) => p.pid)).toEqual([300, 301, 302])
    expect(treeOf(parsePs(ps), 12345)).toEqual([])
  })

  it('names a console by the program it runs', () => {
    const rows = parsePs(ps)
    expect(consoleName(treeOf(rows, 300))).toBe('zsh → claude')
    expect(consoleName(treeOf(rows, 300).slice(0, 1))).toBe('zsh')
  })

  it('counts folio’s own and its servers; a console’s programs apart', () => {
    const owned = new Map<number, Owned>([
      [200, { kind: 'lsp', name: 'intelephense', ref: 'lsp:1' }],
      [300, { kind: 'console', name: 'Console 1', ref: '1' }],
    ])
    const s = buildSample({ at: 1, metrics, os: parsePs(ps), owned, heap: { used: 1, limit: 2 }, label: (k) => k })
    expect(s.procs.map((p) => [p.kind, p.name, Math.round(p.memory / MB)])).toEqual([
      ['main', 'main', 200],
      ['window', 'window', 100],
      ['gpu', 'gpu', 50],
      ['lsp', 'intelephense', 1034],
      ['console', 'zsh → claude', 824],
    ])
    expect(Math.round(s.total.memory / MB)).toBe(1384)
    expect(s.total.cpu).toBe(55.5)
    expect(Math.round(s.outside.memory / MB)).toBe(824)
    expect(s.procs.find((p) => p.kind === 'console')!.outside).toBe(true)
  })
})
