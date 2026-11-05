/**
 * ADR-007 put together for the main process: the log of what happens, the
 * samples of what folio takes, the memory limits acting on them, and keeping
 * the computer awake — with the window's channels for each.
 */
import type { App, BrowserWindow, IpcMain, PowerSaveBlocker, WebContents } from 'electron'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { arch, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { getHeapStatistics } from 'node:v8'
import { Awake, type AwakeHow } from './awake'
import { zip } from './docx'
import { GB, Limits, type LimitAction, type LimitSettings } from './limits'
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
  setApp(o: { logDays?: unknown; limits?: unknown }): void
  logDays(): number
  /** Caches let go: the file and symbol indexes. */
  relieve(): void
  /** A language server's process started again; false — none such. */
  recycleServer(pid: number): boolean
  /** A console closed by its id. */
  closeConsole(id: number): void
  openLog(): Promise<unknown>
  /** Where a report is saved; null — not saved. */
  reportPath(): Promise<string | null>
}

const MB = 1024 * 1024
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
  let lastLogged = 0
  sampler.onSample((s) => {
    d.send('res:sample', s)
    if (s.at - lastLogged >= 60_000) {
      lastLogged = s.at
      log.info('res', 'sample', compact(s))
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
      d.closeConsole(Number(ref ?? p.ref))
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
  ipcMain.handle('app:settings', () => ({ logDays: d.logDays(), limits: limits.current, heapLimit: getHeapStatistics().heap_size_limit, memory: totalmem() }))
  ipcMain.handle('app:set-settings', (_e, o: unknown) => {
    const v = (o ?? {}) as { logDays?: unknown; limits?: unknown }
    d.setApp(v)
    log.setDays(d.logDays())
    limits.set(d.limits())
    log.info('app', 'settings changed', { logDays: d.logDays(), limits: limits.current })
    // Looked at again at once: the gauge shows the new limit now.
    void sampler.tick()
    return { logDays: d.logDays(), limits: limits.current }
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
    stop(): void {
      sampler.stop()
      awake.release()
      log.info('app', 'quit')
      log.close()
    },
  }
}
