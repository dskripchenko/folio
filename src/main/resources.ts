/**
 * What folio takes of the machine (ADR-007, M1): its own processes (Electron's:
 * the main one, windows, GPU, helpers) and those it started (language servers,
 * consoles, formatters), memory and processor each, with everything below them.
 * A console's programs (an agent in it) are shown apart: they are not folio's,
 * so they count neither to its total nor to its limits.
 */
import { execFile } from 'node:child_process'

export type ProcKind = 'main' | 'window' | 'gpu' | 'utility' | 'lsp' | 'console' | 'formatter' | 'other'

export interface ProcSample {
  pid: number
  kind: ProcKind
  /** What it is for people: `intelephense`, `zsh → claude`, `Window`. */
  name: string
  /** Bytes in memory, with everything below it. */
  memory: number
  /** Percent of one processor, with everything below it. */
  cpu: number
  /** A console's: shown, not counted as folio's. */
  outside: boolean
  /** Its own id in folio: a console's, a server's. */
  ref?: string
}

export interface Sample {
  at: number
  /** folio's own: Electron's processes and what it started, consoles left out. */
  total: { memory: number; cpu: number }
  /** What runs in folio's consoles. */
  outside: { memory: number; cpu: number }
  /** The main process's JavaScript heap: used and its limit (bytes). */
  heap: { used: number; limit: number }
  procs: ProcSample[]
  /** The main process's event loop delay since the last sample (ms): the most, and 99 of 100 under it. */
  lag?: { max: number; p99: number }
}

/** A process of the system, as `ps` (or Windows) tells it. */
export interface OsProc {
  pid: number
  ppid: number
  /** Bytes. */
  rss: number
  cpu: number
  comm: string
}

/** What Electron tells of its own processes (`app.getAppMetrics()`), the fields used. */
export interface AppMetric {
  pid: number
  type: string
  name?: string
  serviceName?: string
  cpu: { percentCPUUsage: number }
  /** Kilobytes. */
  memory: { workingSetSize: number }
}

/** A process folio started and knows by its id. */
export interface Owned {
  kind: 'lsp' | 'console' | 'formatter'
  name: string
  ref?: string
}

/** `ps -A -o pid=,ppid=,rss=,%cpu=,comm=`: a line a process, rss in kilobytes. */
export function parsePs(text: string): OsProc[] {
  const out: OsProc[] = []
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(.*)$/)
    if (!m) continue
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, cpu: Number(m[4]!.replace(',', '.')) || 0, comm: m[5]!.trim() })
  }
  return out
}

/** Windows' processes as the PowerShell below prints them: `pid ppid bytes cpu name`, a line each. */
export const parseWin = (text: string): OsProc[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), cpu: Number(m[4]!.replace(',', '.')) || 0, comm: m[5]!.trim() }))

/** A process and all below it, by the parents' ids. */
export function treeOf(procs: readonly OsProc[], pid: number): OsProc[] {
  const kids = new Map<number, OsProc[]>()
  for (const p of procs) {
    if (p.pid === p.ppid) continue
    const list = kids.get(p.ppid)
    if (list) list.push(p)
    else kids.set(p.ppid, [p])
  }
  const self = procs.find((p) => p.pid === pid)
  const out: OsProc[] = self ? [self] : []
  const seen = new Set<number>([pid])
  const queue = [pid]
  while (queue.length > 0) {
    for (const k of kids.get(queue.shift()!) ?? []) {
      if (seen.has(k.pid)) continue
      seen.add(k.pid)
      out.push(k)
      queue.push(k.pid)
    }
  }
  return out
}

const base = (comm: string) => comm.split(/[\\/]/).pop()!.replace(/\.exe$/i, '')

/** The program a console runs now: the deepest of its tree that is not a shell, else the shell. */
export function consoleName(tree: readonly OsProc[]): string {
  if (tree.length === 0) return ''
  const shells = /^-?(zsh|bash|sh|fish|dash|ksh|tcsh|pwsh|powershell|cmd|nu)$/i
  const shell = base(tree[0]!.comm).replace(/^-/, '')
  const busy = tree.slice(1).filter((p) => !shells.test(base(p.comm)))
  return busy.length > 0 ? `${shell} → ${base(busy[0]!.comm)}` : shell
}

const kindOf = (type: string): ProcKind => (type === 'Browser' ? 'main' : type === 'Tab' ? 'window' : type === 'GPU' ? 'gpu' : 'utility')

/**
 * One sample: Electron's processes (each with what is below it but not
 * known apart), then those folio started, by their trees.
 */
export function buildSample(o: {
  at: number
  metrics: readonly AppMetric[]
  os: readonly OsProc[]
  owned: ReadonlyMap<number, Owned>
  heap: { used: number; limit: number }
  /** A name for a kind of Electron's processes. */
  label: (kind: ProcKind, metric: AppMetric) => string
}): Sample {
  const procs: ProcSample[] = []
  const taken = new Set<number>()
  // folio's own children first: their trees are theirs, not their parents'.
  for (const [pid, own] of o.owned) {
    const tree = treeOf(o.os, pid)
    if (tree.length === 0) continue
    for (const p of tree) taken.add(p.pid)
    procs.push({
      pid,
      kind: own.kind,
      name: own.kind === 'console' ? consoleName(tree) || own.name : own.name,
      memory: tree.reduce((n, p) => n + p.rss, 0),
      cpu: tree.reduce((n, p) => n + p.cpu, 0),
      outside: own.kind === 'console',
      ...(own.ref ? { ref: own.ref } : {}),
    })
  }
  const electron = new Set(o.metrics.map((m) => m.pid))
  for (const m of o.metrics) {
    const kind = kindOf(m.type)
    // Below it: what folio did not start itself (a helper of a helper), not Electron's own.
    const below = treeOf(o.os, m.pid).filter((p) => p.pid !== m.pid && !taken.has(p.pid) && !electron.has(p.pid))
    for (const p of below) taken.add(p.pid)
    procs.push({
      pid: m.pid,
      kind,
      name: o.label(kind, m),
      memory: m.memory.workingSetSize * 1024 + below.reduce((n, p) => n + p.rss, 0),
      cpu: m.cpu.percentCPUUsage + below.reduce((n, p) => n + p.cpu, 0),
      outside: false,
    })
  }
  const order: ProcKind[] = ['main', 'window', 'gpu', 'utility', 'lsp', 'formatter', 'console', 'other']
  procs.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.memory - a.memory)
  const sum = (outside: boolean) => {
    const list = procs.filter((p) => p.outside === outside)
    return { memory: list.reduce((n, p) => n + p.memory, 0), cpu: Math.round(list.reduce((n, p) => n + p.cpu, 0) * 10) / 10 }
  }
  return { at: o.at, total: sum(false), outside: sum(true), heap: o.heap, procs }
}

const WIN_PS =
  "$p=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property IDProcess,PercentProcessorTime | Group-Object -AsHashTable -Property IDProcess;" +
  "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,Name | ForEach-Object { $c=0; if ($p -and $p[[int]$_.ProcessId]) { $c=$p[[int]$_.ProcessId][0].PercentProcessorTime }; \"$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize) $c $($_.Name)\" }"

/** The system's processes now; none where they cannot be read. */
export function osProcesses(platform = process.platform): Promise<OsProc[]> {
  return new Promise((resolve) => {
    const done = (parse: (t: string) => OsProc[]) => (err: Error | null, out: string) => resolve(err ? [] : parse(String(out)))
    if (platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_PS], { windowsHide: true, timeout: 10_000, maxBuffer: 8 << 20 }, done(parseWin))
    else execFile('ps', ['-A', '-o', 'pid=,ppid=,rss=,%cpu=,comm='], { timeout: 5_000, maxBuffer: 8 << 20 }, done(parsePs))
  })
}

export interface SamplerDeps {
  metrics(): AppMetric[]
  os(): Promise<OsProc[]>
  heap(): { used: number; limit: number }
  label: (kind: ProcKind, metric: AppMetric) => string
  now?: () => number
}

/**
 * Samples taken every so often — often while someone looks, seldom otherwise —
 * never two at once; the last half hour kept for the chart.
 */
export class Sampler {
  private readonly owned = new Map<number, Owned>()
  private readonly listeners = new Set<(s: Sample) => void>()
  private readonly history: Sample[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private watching = 0
  private stopped = true
  last: Sample | null = null

  constructor(
    private readonly deps: SamplerDeps,
    private readonly every: { idle: number; watched: number } = { idle: 15_000, watched: 2_000 },
    private readonly keep = 30 * 60_000,
  ) {}

  /** How often while nobody looks (seldom on battery, ADR-008). */
  setIdle(ms: number): void {
    this.every.idle = ms
  }

  own(pid: number | undefined, what: Owned): void {
    if (pid) this.owned.set(pid, what)
  }

  disown(pid: number | undefined): void {
    if (pid) this.owned.delete(pid)
  }

  onSample(fn: (s: Sample) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Someone looks (the panel open): samples often until they stop. */
  watch(on: boolean): void {
    this.watching = Math.max(0, this.watching + (on ? 1 : -1))
    if (on && !this.stopped) this.schedule(0)
  }

  start(): void {
    this.stopped = false
    this.schedule(1_000)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** The samples of the last half hour, oldest first. */
  past(): Sample[] {
    return [...this.history]
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), ms)
    this.timer.unref?.()
  }

  async tick(): Promise<Sample | null> {
    if (this.running) return null
    this.running = true
    let sample: Sample | null
    try {
      const os = await this.deps.os()
      const now = this.deps.now?.() ?? Date.now()
      // Gone ones are forgotten.
      const alive = new Set(os.map((p) => p.pid))
      if (os.length > 0) for (const pid of [...this.owned.keys()]) if (!alive.has(pid)) this.owned.delete(pid)
      sample = buildSample({ at: now, metrics: this.deps.metrics(), os, owned: this.owned, heap: this.deps.heap(), label: this.deps.label })
      this.last = sample
      this.history.push(sample)
      while (this.history.length > 0 && this.history[0]!.at < now - this.keep) this.history.shift()
      for (const fn of this.listeners) {
        try {
          fn(sample)
        } catch {
          // A listener's fault is not the sampler's.
        }
      }
    } catch {
      sample = null
    } finally {
      this.running = false
      if (!this.stopped) this.schedule(this.watching > 0 ? this.every.watched : this.every.idle)
    }
    return sample
  }
}
