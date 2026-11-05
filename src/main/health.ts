/**
 * ADR-007 put together for the main process: the log of what happens, the
 * samples of what folio takes, the memory limits acting on them, and keeping
 * the computer awake — with the window's channels for each.
 */
import type { App, BrowserWindow, IpcMain, PowerMonitor, PowerSaveBlocker, WebContents } from 'electron'
import { readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { arch, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { getHeapStatistics } from 'node:v8'
import { Awake, type AwakeHow } from './awake'
import { flightStats } from './flight'
import { zip } from './docx'
import { GB, Limits, type AlertSettings, type LimitAction, type LimitSettings } from './limits'
import { errorData, type Log } from './log'
import { osProcesses, Sampler, type ProcKind, type Sample } from './resources'

export interface HealthDeps {
  app: App
  ipcMain: IpcMain
  powerSaveBlocker: PowerSaveBlocker
  log: Log
  /** Where crash dumps are written. */
  crashes: string
  send(channel: string, ...args: unknown[]): void
  window(): BrowserWindow | null
  limits(): LimitSettings
  setApp(o: { logDays?: unknown; limits?: unknown; alerts?: unknown }): void
  logDays(): number
  /** Caches let go: the file and symbol indexes. */
  relieve(): void
  /** A language server's process started again; false — none such. */
  recycleServer(pid: number): boolean
  openLog(): Promise<unknown>
  powerMonitor: PowerMonitor
  /** folio-data, whose disk is watched and whose size is told. */
  data: string
  alerts(): AlertSettings
  /** How the run before this one ended (read before this run's start was written). */
  lastRun: { ended: 'clean' | 'crashed' | 'unknown'; at: string | null }
  /** A system notification; a click brings the window forward at that console. */
  notify(title: string, body: string, consoleId: number | null): void
  /** The words of the notifications, in folio's language. */
  words(): { commandDone: string; commandFailed: string; attention: string; attentionBody: string; console: string }
  /** Downloaded updates removed (a ready one kept). */
  tidyUpdates(): void
  /** Where a report is saved; null — not saved. */
  reportPath(): Promise<string | null>
}

const MB = 1024 * 1024

/** The flights running or waiting now, by kind (none: empty). */
function busyFlights(): Record<string, { running: number; queued: number }> {
  return Object.fromEntries(Object.entries(flightStats()).filter(([, v]) => v.running + v.queued > 0))
}
const mb = (n: number) => Math.round(n / MB)

/** A sample as the log keeps it: megabytes, a line. */
function compact(s: Sample) {
  return {
    total: mb(s.total.memory),
    cpu: s.total.cpu,
    outside: mb(s.outside.memory),
    heap: mb(s.heap.used),
    procs: s.procs.map((p) => [p.kind, p.name, mb(p.memory), Math.round(p.cpu)]),
  }
}

/** Handlers that wait for a person (a dialog, a question): never slow on their own. */
const ASKS = new Set([
  'doc:open-dialog',
  'doc:save-as',
  'doc:confirm-close',
  'ws:add-project',
  'ws:set-shared',
  'folders:choose',
  'export:save',
  'pdf:export',
  'log:report',
  'lsp:open',
  'git:login',
  'fs:trash',
])

/**
 * Every window's request timed (ADR-008, S2): one taking longer than `slowMs`
 * goes to the log — its channel and time, never its arguments (paths, texts).
 * Set up before the handlers are, so it sees them all. `after` hears each one
 * done (what folio wrote itself is known at once, not when the watcher says so).
 */
export function timeHandlers(ipcMain: IpcMain, log: Log, after: (channel: string) => void = () => undefined, slowMs = 2000): void {
  const handle = ipcMain.handle.bind(ipcMain)
  type Listener = Parameters<IpcMain['handle']>[1]
  ipcMain.handle = ((channel: string, listener: Listener) =>
    handle(channel, async (...args: Parameters<Listener>) => {
      const t = performance.now()
      try {
        return await listener(...args)
      } finally {
        after(channel)
        const ms = Math.round(performance.now() - t)
        if (ms >= slowMs && !ASKS.has(channel)) log.warn('slow', channel, { ms })
      }
    })) as typeof ipcMain.handle
}

export function startHealth(d: HealthDeps) {
  const { log } = d
  const sampler = new Sampler({
    metrics: () => d.app.getAppMetrics() as never,
    os: () => osProcesses(),
    heap: () => {
      const h = getHeapStatistics()
      return { used: h.used_heap_size, limit: h.heap_size_limit }
    },
    // Electron's kinds are named by the window, in its language; a helper by its service.
    label: (kind: ProcKind, m) => (kind === 'utility' ? (m.serviceName ?? m.name ?? '') : ''),
  })
  const limits = new Limits(d.limits())
  // How long the main process kept others waiting (ADR-008): the event loop's delay between samples.
  const delay = monitorEventLoopDelay({ resolution: 20 })
  delay.enable()
  let tickAt = performance.now()
  const stall = setInterval(() => {
    const now = performance.now()
    const late = Math.round(now - tickAt - 1000)
    tickAt = now
    if (late >= 1000) log.warn('lag', 'the main process stood still', { ms: late, flights: busyFlights() })
  }, 1000)
  stall.unref?.()
  let lastLogged = 0
  sampler.onSample((s) => {
    s.lag = { max: Math.round(delay.max / 1e6), p99: Math.round(delay.percentile(99) / 1e6) }
    delay.reset()
    d.send('res:sample', s)
    if (s.at - lastLogged >= 60_000) {
      lastLogged = s.at
      log.info('res', 'sample', { ...compact(s), lag: s.lag, flights: busyFlights() })
    }
    for (const a of limits.check(s)) act(a)
  })

  function act(a: LimitAction): void {
    const heaviest = 'heaviest' in a && a.heaviest ? { kind: a.heaviest.kind, name: a.heaviest.name, mb: mb(a.heaviest.memory) } : null
    if (a.kind === 'restart-lsp') {
      log.warn('limits', 'language server over its limit: started again', { name: a.proc.name, mb: mb(a.proc.memory), limitGb: limits.current.lspGb })
      d.recycleServer(a.proc.pid)
      d.send('res:limit', { kind: 'lsp', name: a.proc.name, memory: a.proc.memory })
      return
    }
    if (a.kind === 'relieve') {
      log.warn('limits', 'over the soft limit: letting go', { mb: mb(a.memory), limitGb: limits.current.softGb, heaviest })
      d.relieve()
      void d.window()?.webContents.session.clearCache()
      if (a.heaviest?.kind === 'lsp') d.recycleServer(a.heaviest.pid)
    } else if (a.kind === 'warn') log.warn('limits', 'still over the soft limit', { mb: mb(a.memory), heaviest })
    else log.info('limits', 'under the soft limit again', { mb: mb(a.memory) })
    d.send('res:limit', { kind: a.kind, memory: a.memory, limit: limits.current.softGb * GB, heaviest: 'heaviest' in a ? a.heaviest : null })
  }

  // A console grown big, or busy for long (ADR-008): told, never touched.
  const consoleSaid = new Map<string, number>()
  const busySince = new Map<string, number>()
  sampler.onSample((s) => {
    const gb = d.alerts().consoleGb
    for (const p of s.procs) {
      if (p.kind !== 'console' || !p.ref) continue
      if (p.cpu >= 100) busySince.set(p.ref, busySince.get(p.ref) ?? s.at)
      else busySince.delete(p.ref)
      const big = gb > 0 && p.memory > gb * GB
      const hot = s.at - (busySince.get(p.ref) ?? s.at) >= 5 * 60_000
      if (!big && !hot) continue
      const last = consoleSaid.get(p.ref)
      if (last !== undefined && s.at - last < 30 * 60_000) continue
      consoleSaid.set(p.ref, s.at)
      log.warn('console', big ? 'a console takes much memory' : 'a console keeps the processor busy', { name: p.name, mb: mb(p.memory), cpu: Math.round(p.cpu) })
      d.send('res:console', { id: Number(p.ref), name: p.name, memory: p.memory, cpu: p.cpu, why: big ? 'memory' : 'cpu' })
    }
  })

  // A console's command done, a program asking for attention: told when folio is not in front (ADR-008).
  const asked = new Map<number, number>()
  const consoleName = (id: number) => {
    const p = sampler.last?.procs.find((x) => x.kind === 'console' && x.ref === String(id))
    return p?.name ? `${d.words().console.replace('{n}', String(id))} (${p.name})` : d.words().console.replace('{n}', String(id))
  }
  const inFront = () => d.window()?.isFocused() ?? false
  const duration = (ms: number) => {
    const s = Math.round(ms / 1000)
    return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
  }
  function consoleFinished(id: number, done: { command: string | null; code: number | null; ms: number }): void {
    const sec = d.alerts().commandSec
    if (sec <= 0 || done.ms < sec * 1000) return
    log.info('console', 'a long command ended', { code: done.code, ms: done.ms })
    if (inFront()) return
    const w = d.words()
    const title = (done.code === 0 || done.code === null ? w.commandDone : w.commandFailed).replace('{console}', consoleName(id)).replace('{code}', String(done.code))
    d.notify(title, `${(done.command ?? '').slice(0, 120)} · ${duration(done.ms)}`.replace(/^ · /, ''), id)
  }
  function consoleAttention(id: number, text: string | null): void {
    const now = Date.now()
    if (now - (asked.get(id) ?? 0) < 30_000) return
    asked.set(id, now)
    log.info('console', 'a program asks for attention', { message: text !== null })
    if (inFront()) return
    const w = d.words()
    d.notify(w.attention.replace('{console}', consoleName(id)), text?.slice(0, 200) || w.attentionBody, id)
  }

  // The disk under folio-data: little room left is said, at start and every ten minutes (ADR-008).
  let diskSaid = 0
  function checkDisk(): { free: number; total: number } | null {
    try {
      const st = statfsSync(d.data)
      const free = st.bavail * st.bsize
      const total = st.blocks * st.bsize
      const gb = d.alerts().diskGb
      if (gb > 0 && free < gb * GB && Date.now() - diskSaid > 60 * 60_000) {
        diskSaid = Date.now()
        log.warn('disk', 'little room left on the disk', { freeMb: mb(free) })
        d.send('res:disk', { free, total })
      }
      return { free, total }
    } catch {
      return null
    }
  }
  const diskTimer = setInterval(checkDisk, 10 * 60_000)
  diskTimer.unref?.()
  setTimeout(checkDisk, 5_000).unref?.()

  // On battery: sampled seldom (ADR-008). The power monitor answers once the app is ready.
  const power = () => {
    const battery = d.powerMonitor.isOnBatteryPower()
    sampler.setIdle(battery ? 60_000 : 15_000)
    return battery
  }
  function ready(): void {
    power()
    d.powerMonitor.on('on-battery', () => log.info('power', 'on battery', { sampled: power() ? 60 : 15 }))
    d.powerMonitor.on('on-ac', () => log.info('power', 'on power', { sampled: power() ? 60 : 15 }))
    sampler.start()
  }

  // The run before ended without quitting: said once, to the first window that asks.
  let lastRun = d.lastRun
  if (lastRun.ended === 'crashed') log.warn('app', 'the last run ended without quitting', { started: lastRun.at })

  const awake = new Awake(d.powerSaveBlocker)
  awake.onChange((s) => d.send('awake:changed', s))
  let lastHow: AwakeHow = 'off'
  awake.onChange((s) => {
    if (s.how !== lastHow) log.info('awake', `keep awake: ${s.how}`, { display: s.display, until: s.until, granted: s.granted })
    if (s.holding && !s.granted) log.warn('awake', 'the system did not take the request to stay awake')
    lastHow = s.how
  })

  const { ipcMain } = d
  ipcMain.handle('res:now', () => sampler.last)
  ipcMain.handle('res:past', () => sampler.past())
  ipcMain.on('res:watch', (_e, on: unknown) => sampler.watch(on === true))
  ipcMain.handle('res:end', (_e, pid: unknown, ref: unknown) => {
    const p = sampler.last?.procs.find((x) => x.pid === pid)
    if (!p) return false
    log.info('res', 'process ended by hand', { kind: p.kind, name: p.name, mb: mb(p.memory) })
    if (p.kind === 'lsp') return d.recycleServer(p.pid)
    if (p.kind === 'console') {
      // Closed by the window, as its tab's close: the tab goes with it.
      d.send('console:close-tab', Number(ref ?? p.ref))
      return true
    }
    if (p.kind === 'main' || p.kind === 'window' || p.kind === 'gpu' || p.kind === 'utility') return false
    try {
      process.kill(p.pid)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('awake:get', () => awake.state)
  ipcMain.handle('awake:set', (_e, how: unknown, o: unknown) => {
    const opts = (o ?? {}) as { display?: unknown; minutes?: unknown; until?: unknown }
    if (how === 'display') return awake.setDisplay(opts.display === true)
    if (how !== 'off' && how !== 'on' && how !== 'until' && how !== 'busy') return awake.state
    return awake.set(how, {
      ...(typeof opts.display === 'boolean' ? { display: opts.display } : {}),
      ...(typeof opts.minutes === 'number' && opts.minutes > 0 ? { minutes: opts.minutes } : {}),
      ...(typeof opts.until === 'number' ? { until: opts.until } : {}),
    })
  })
  ipcMain.handle('app:settings', () => ({ logDays: d.logDays(), limits: limits.current, alerts: d.alerts(), heapLimit: getHeapStatistics().heap_size_limit, memory: totalmem() }))
  ipcMain.handle('app:set-settings', (_e, o: unknown) => {
    const v = (o ?? {}) as { logDays?: unknown; limits?: unknown; alerts?: unknown }
    d.setApp(v)
    log.setDays(d.logDays())
    limits.set(d.limits())
    log.info('app', 'settings changed', { logDays: d.logDays(), limits: limits.current, alerts: d.alerts() })
    // Looked at again at once: the gauge shows the new limit now.
    void sampler.tick()
    return { logDays: d.logDays(), limits: limits.current, alerts: d.alerts() }
  })
  ipcMain.handle('log:report', async () => {
    const path = await d.reportPath()
    if (!path) return null
    log.flush()
    const files: [string, string | Uint8Array][] = [
      ['folio.json', JSON.stringify({ version: d.app.getVersion(), os: `${platform()} ${release()} ${arch()}`, memory: totalmem(), electron: process.versions.electron, sample: sampler.last }, null, 2)],
    ]
    // The last three days of the log, and the crash dumps.
    for (const f of log.files().slice(0, 6)) files.push([`logs/${f.split(/[\\/]/).pop()}`, readFileSync(f)])
    try {
      for (const name of readdirSync(d.crashes, { recursive: true }) as string[]) {
        const full = join(d.crashes, name)
        if (statSync(full).isFile() && statSync(full).size < 50 * MB) files.push([`crashes/${name.split('\\').join('/')}`, readFileSync(full)])
      }
    } catch {
      // No dumps.
    }
    writeFileSync(path, zip(files))
    return path
  })
  ipcMain.handle('log:open', () => d.openLog())
  ipcMain.handle('app:last-run', () => {
    const r = lastRun
    lastRun = { ended: 'unknown', at: null }
    return r
  })
  ipcMain.handle('app:disk', () => checkDisk())
  ipcMain.handle('app:data-size', async () => {
    const sizeOf = async (dir: string): Promise<number> => {
      let n = 0
      try {
        for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
          if (!e.isFile()) continue
          try {
            n += (await stat(join(e.parentPath, e.name))).size
          } catch {
            // Gone meanwhile.
          }
        }
      } catch {
        // Not there.
      }
      return n
    }
    const parts = ['chromium', 'update', 'crashes', 'logs', 'session', 'review'] as const
    const sizes = Object.fromEntries(await Promise.all(parts.map(async (p) => [p, await sizeOf(join(d.data, p))] as const)))
    const total = await sizeOf(d.data)
    return { total, ...sizes }
  })
  ipcMain.handle('app:clear-caches', async () => {
    const w = d.window()
    if (w && !w.isDestroyed()) {
      await w.webContents.session.clearCache()
      await w.webContents.session.clearCodeCaches({})
    }
    d.tidyUpdates()
    try {
      for (const name of readdirSync(d.crashes)) rmSync(join(d.crashes, name), { recursive: true, force: true })
    } catch {
      // No dumps.
    }
    log.info('app', 'caches cleared')
    return true
  })
  ipcMain.handle('app:relaunch', () => {
    log.info('app', 'started again by hand')
    d.app.relaunch()
    d.app.quit()
  })

  /** A window's falls and stalls, into the log. */
  function watchWindow(w: BrowserWindow): void {
    const wc: WebContents = w.webContents
    wc.on('render-process-gone', (_e, details) => log.error('window', 'the window’s process is gone', details))
    wc.on('unresponsive', () => log.warn('window', 'the window does not answer'))
    wc.on('responsive', () => log.info('window', 'the window answers again'))
    wc.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e as unknown as { level: string; message: string; lineNumber: number; sourceId: string }
      if (level === 'error') log.write('error', 'window', String(message).slice(0, 2000), { line: lineNumber, source: String(sourceId).split('/').pop() }, 'window')
    })
  }

  d.app.on('child-process-gone', (_e, details) => log.error('app', 'a process is gone', details))
  process.on('uncaughtExceptionMonitor', (e) => {
    log.error('main', 'uncaught exception', errorData(e))
    log.flush()
  })
  process.on('unhandledRejection', (e) => log.error('main', 'unhandled rejection', errorData(e)))

  return {
    sampler,
    awake,
    limits,
    watchWindow,
    /** A console's commands running: kept awake while there are. */
    running: (count: number) => awake.busy(count),
    consoleFinished,
    consoleAttention,
    /** The app is ready: sampling begins, the power source is known. */
    ready,
    stop(): void {
      clearInterval(stall)
      clearInterval(diskTimer)
      delay.disable()
      sampler.stop()
      awake.release()
      log.info('app', 'quit')
      log.close()
    },
  }
}
