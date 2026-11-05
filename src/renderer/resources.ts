/**
 * What folio takes, seen from the window (ADR-007): a gauge in the rail (all of
 * folio's memory and processor, coloured past the limit), the processes window
 * (each process, a chart of the last half hour, ending or restarting one), a
 * note when the limit is passed, and keeping the computer awake.
 */
import type { AwakeState, ResKind, ResProc, ResSample } from './bridge'
import { icon } from './icons'
import { bytes } from './mediaView'
import { popMenu, type MenuItem } from './menu'

export interface ResourcesText {
  title: string
  gauge: string
  folio: string
  outside: string
  heap: string
  kinds: Record<ResKind, string>
  name: string
  memory: string
  cpu: string
  restart: string
  end: string
  close: string
  endConfirm: string
  chart: string
  limit: string
  over: string
  restartIt: string
  restartFolio: string
  show: string
  dismiss: string
  lspRestarted: string
  report: string
  reportSaved: string
  openLog: string
}

export interface AwakeText {
  title: string
  off: string
  on: string
  hours: string
  busy: string
  display: string
  nowOff: string
  nowOn: string
  nowUntil: string
  nowBusy: string
  nowBusyIdle: string
  notGranted: string
  lid: string
}

export interface ResourcesDeps {
  text(): ResourcesText
  units(): readonly string[]
  lang(): string
  now(): Promise<ResSample | null>
  past(): Promise<ResSample[]>
  watch(on: boolean): void
  end(pid: number, ref: string | undefined): Promise<boolean>
  /** The soft limit, bytes; 0 — none. */
  limit(): Promise<number>
  relaunch(): void
  openLog(): void
  saveReport(): Promise<string | null>
  notify(message: string): void
}

/** A helper's service for people: `network.mojom.NetworkService` → `Network Service`. */
export function serviceName(name: string): string {
  const last = name.split('.').pop() ?? name
  return last.replace(/([a-z])([A-Z])/g, '$1 $2')
}

/** A sample's label in the rail: `1.2G`, `640M`. */
export function shortBytes(n: number): string {
  const gb = n / 1024 ** 3
  if (gb >= 10) return `${Math.round(gb)}G`
  if (gb >= 1) return `${(Math.round(gb * 10) / 10).toFixed(1)}G`
  return `${Math.max(1, Math.round(n / 1024 ** 2))}M`
}

/** The chart's path: memory over time, in a box of `w` × `h`, the top at `max`. */
export function chartPath(points: readonly { at: number; memory: number }[], w: number, h: number, max: number, span: number, end: number): string {
  if (points.length === 0 || max <= 0) return ''
  const x = (at: number) => Math.round((w - ((end - at) / span) * w) * 10) / 10
  const y = (m: number) => Math.round((h - Math.min(1, m / max) * h) * 10) / 10
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at)},${y(p.memory)}`).join(' ')
}

export class Resources {
  readonly gauge: HTMLButtonElement
  readonly el: HTMLElement
  private readonly box: HTMLElement
  private last: ResSample | null = null
  private history: ResSample[] = []
  private limitBytes = 0
  private over = false
  private toast: HTMLElement | null = null

  constructor(private readonly deps: ResourcesDeps) {
    this.gauge = document.createElement('button')
    this.gauge.type = 'button'
    this.gauge.className = 'rail-gauge'
    this.gauge.dataset.testid = 'res-gauge'
    this.gauge.addEventListener('click', () => void this.open())
    this.el = document.createElement('div')
    this.el.className = 'palette-backdrop settings-backdrop'
    this.el.dataset.testid = 'processes'
    this.el.hidden = true
    this.box = document.createElement('div')
    this.box.className = 'settings-dialog res-dialog'
    this.box.setAttribute('role', 'dialog')
    this.el.append(this.box)
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close()
    })
    window.addEventListener('keydown', (e) => {
      if (!this.el.hidden && e.key === 'Escape') {
        e.preventDefault()
        this.close()
      }
    })
    document.body.append(this.el)
    void this.deps.limit().then((n) => (this.limitBytes = n))
    void this.deps.now().then((s) => s && this.sample(s))
    this.drawGauge()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  /** The limit changed in the settings. */
  setLimit(bytes: number): void {
    this.limitBytes = bytes
    this.drawGauge()
  }

  sample(s: ResSample): void {
    this.last = s
    this.history.push(s)
    while (this.history.length > 0 && this.history[0]!.at < s.at - 30 * 60_000) this.history.shift()
    this.drawGauge()
    if (this.visible) this.draw()
  }

  /** The limit passed, or a language server started again (from the main process). */
  limitEvent(e: { kind: string; memory: number; limit?: number; name?: string; heaviest?: ResProc | null }): void {
    const t = this.deps.text()
    const size = (n: number) => bytes(n, this.deps.lang(), this.deps.units())
    if (e.kind === 'lsp') return this.deps.notify(t.lspRestarted.replace('{name}', e.name ?? '').replace('{memory}', size(e.memory)))
    if (e.kind === 'clear') {
      this.over = false
      this.toast?.remove()
      this.toast = null
      return this.drawGauge()
    }
    this.over = true
    this.drawGauge()
    if (e.kind !== 'warn') return
    const heavy = e.heaviest
    const message = t.over
      .replace('{memory}', size(e.memory))
      .replace('{limit}', size(e.limit ?? this.limitBytes))
      .replace('{name}', heavy ? this.nameOf(heavy) : '—')
      .replace('{heavy}', heavy ? size(heavy.memory) : '—')
    const actions: [string, () => void][] = []
    if (heavy?.kind === 'lsp') actions.push([t.restartIt, () => void this.deps.end(heavy.pid, heavy.ref)])
    actions.push([t.restartFolio, () => this.deps.relaunch()], [t.show, () => void this.open()])
    this.showToast(message, actions)
  }

  private showToast(message: string, actions: [string, () => void][]): void {
    const t = this.deps.text()
    this.toast?.remove()
    const el = document.createElement('div')
    el.className = 'res-toast'
    el.setAttribute('role', 'alert')
    el.dataset.testid = 'res-toast'
    const text = document.createElement('span')
    text.textContent = message
    el.append(text)
    for (const [label, run] of [...actions, [t.dismiss, () => undefined] as [string, () => void]]) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', () => {
        el.remove()
        if (this.toast === el) this.toast = null
        run()
      })
      el.append(b)
    }
    document.body.append(el)
    this.toast = el
  }

  private nameOf(p: ResProc): string {
    const t = this.deps.text()
    const kind = t.kinds[p.kind]
    if (p.kind === 'lsp' || p.kind === 'utility') return p.name ? `${p.name}` : kind
    if (p.kind === 'console') return `${kind}: ${p.name}`
    return kind
  }

  /** Drawn again (the words changed). */
  refresh(): void {
    this.drawGauge()
    if (this.visible) this.draw()
  }

  private drawGauge(): void {
    const t = this.deps.text()
    const s = this.last
    const memory = s?.total.memory ?? 0
    const label = document.createElement('span')
    label.className = 'rail-gauge-value'
    label.textContent = s ? shortBytes(memory) : '…'
    const bar = document.createElement('span')
    bar.className = 'rail-gauge-bar'
    const fill = document.createElement('span')
    fill.style.width = `${this.limitBytes > 0 ? Math.min(100, Math.round((memory / this.limitBytes) * 100)) : 0}%`
    bar.append(fill)
    this.gauge.replaceChildren(icon('activity', 14), label, bar)
    const over = this.over || (this.limitBytes > 0 && memory > this.limitBytes)
    this.gauge.dataset.state = over ? 'over' : this.limitBytes > 0 && memory > this.limitBytes * 0.75 ? 'near' : 'ok'
    const title = t.gauge.replace('{memory}', bytes(memory, this.deps.lang(), this.deps.units())).replace('{cpu}', `${Math.round(s?.total.cpu ?? 0)}%`)
    this.gauge.title = title
    this.gauge.setAttribute('aria-label', title)
  }

  async open(): Promise<void> {
    if (this.visible) return
    this.el.hidden = false
    this.deps.watch(true)
    this.history = await this.deps.past()
    this.limitBytes = await this.deps.limit()
    if (this.history.length > 0) this.last = this.history[this.history.length - 1]!
    this.draw()
  }

  close(): void {
    if (this.el.hidden) return
    this.el.hidden = true
    this.deps.watch(false)
  }

  private draw(): void {
    const t = this.deps.text()
    const s = this.last
    const size = (n: number) => bytes(n, this.deps.lang(), this.deps.units())
    const head = document.createElement('header')
    const title = document.createElement('strong')
    title.textContent = t.title
    const sum = document.createElement('span')
    sum.className = 'res-sum'
    sum.dataset.testid = 'res-total'
    sum.textContent = s ? `${t.folio}: ${size(s.total.memory)} · ${Math.round(s.total.cpu)}%` : ''
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'settings-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t.close)
    close.addEventListener('click', () => this.close())
    head.append(title, sum, close)

    const body = document.createElement('div')
    body.className = 'res-body'
    body.append(this.chart())
    const table = document.createElement('table')
    table.className = 'res-table'
    const tr = document.createElement('tr')
    for (const h of [t.name, t.memory, t.cpu, '']) {
      const th = document.createElement('th')
      th.textContent = h
      tr.append(th)
    }
    table.append(tr)
    const own = s?.procs.filter((p) => !p.outside) ?? []
    const outside = s?.procs.filter((p) => p.outside) ?? []
    for (const p of own) table.append(this.row(p))
    if (outside.length > 0) {
      const sep = document.createElement('tr')
      sep.className = 'res-group'
      const td = document.createElement('td')
      td.colSpan = 4
      td.textContent = `${t.outside}: ${size(s!.outside.memory)} · ${Math.round(s!.outside.cpu)}%`
      sep.append(td)
      table.append(sep)
      for (const p of outside) table.append(this.row(p))
    }
    body.append(table)
    const foot = document.createElement('footer')
    foot.className = 'res-foot'
    const heap = document.createElement('span')
    heap.textContent = s ? t.heap.replace('{used}', size(s.heap.used)).replace('{limit}', size(s.heap.limit)) : ''
    const openLog = document.createElement('button')
    openLog.type = 'button'
    openLog.textContent = t.openLog
    openLog.addEventListener('click', () => this.deps.openLog())
    const report = document.createElement('button')
    report.type = 'button'
    report.textContent = t.report
    report.dataset.testid = 'res-report'
    report.addEventListener('click', () => void this.deps.saveReport().then((path) => path && this.deps.notify(t.reportSaved.replace('{path}', path))))
    foot.append(heap, openLog, report)
    this.box.replaceChildren(head, body, foot)
  }

  private row(p: ResProc): HTMLElement {
    const t = this.deps.text()
    const tr = document.createElement('tr')
    tr.dataset.kind = p.kind
    tr.dataset.testid = `res-row-${p.kind}`
    const name = document.createElement('td')
    const kind = document.createElement('span')
    kind.className = 'res-kind'
    kind.textContent = t.kinds[p.kind]
    name.append(kind)
    if (p.name && p.kind !== 'main' && p.kind !== 'window' && p.kind !== 'gpu') {
      const n = document.createElement('span')
      n.className = 'res-name'
      n.textContent = p.kind === 'utility' ? serviceName(p.name) : p.name
      name.append(n)
    }
    const mem = document.createElement('td')
    mem.textContent = bytes(p.memory, this.deps.lang(), this.deps.units())
    const cpu = document.createElement('td')
    cpu.textContent = `${Math.round(p.cpu)}%`
    const act = document.createElement('td')
    // Electron's own helpers (the network, storage) are never ended from here: folio needs them.
    const label = p.kind === 'lsp' ? t.restart : p.kind === 'console' ? t.close : p.kind === 'other' || p.kind === 'formatter' ? t.end : null
    if (label) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.dataset.testid = `res-end-${p.pid}`
      b.addEventListener('click', () => {
        if (p.kind !== 'lsp' && !confirm(t.endConfirm.replace('{name}', this.nameOf(p)))) return
        void this.deps.end(p.pid, p.ref)
      })
      act.append(b)
    }
    tr.append(name, mem, cpu, act)
    return tr
  }

  private chart(): HTMLElement {
    const t = this.deps.text()
    const wrap = document.createElement('figure')
    wrap.className = 'res-chart'
    const W = 600
    const H = 90
    const end = this.last?.at ?? Date.now()
    const span = 30 * 60_000
    const points = this.history.map((s) => ({ at: s.at, memory: s.total.memory }))
    // Scaled to what folio takes; the limit drawn when it is near enough to be seen with it.
    const peak = Math.max(...points.map((p) => p.memory), 1)
    const showLimit = this.limitBytes > 0 && this.limitBytes < peak * 3
    const max = Math.max(peak, showLimit ? this.limitBytes : 0) * 1.15
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', t.chart)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', chartPath(points, W, H, max, span, end))
    path.setAttribute('class', 'res-line')
    svg.append(path)
    const lastPoint = points[points.length - 1]
    if (lastPoint) {
      // The newest sample as a dot: one sample is not yet a line.
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      const y = H - (lastPoint.memory / max) * H
      dot.setAttribute('x1', String(W - 1))
      dot.setAttribute('x2', String(W - 1))
      dot.setAttribute('y1', String(y))
      dot.setAttribute('y2', String(y))
      dot.setAttribute('class', 'res-dot')
      svg.append(dot)
    }
    if (showLimit) {
      const y = H - (this.limitBytes / max) * H
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', '0')
      line.setAttribute('x2', String(W))
      line.setAttribute('y1', String(y))
      line.setAttribute('y2', String(y))
      line.setAttribute('class', 'res-limit')
      svg.append(line)
    }
    const caption = document.createElement('figcaption')
    caption.textContent = this.limitBytes > 0 ? `${t.chart} · ${t.limit.replace('{n}', bytes(this.limitBytes, this.deps.lang(), this.deps.units()))}` : t.chart
    wrap.append(svg, caption)
    return wrap
  }
}

/** The rail's button for staying awake, and its menu. */
export class AwakeButton {
  readonly el: HTMLButtonElement
  private state: AwakeState = { how: 'off', display: false, until: null, holding: false, granted: false }

  constructor(
    private readonly deps: {
      text(): AwakeText
      lang(): string
      mac: boolean
      get(): Promise<AwakeState>
      set(how: 'off' | 'on' | 'until' | 'busy' | 'display', o?: { display?: boolean; minutes?: number }): Promise<AwakeState>
    },
  ) {
    this.el = document.createElement('button')
    this.el.type = 'button'
    this.el.className = 'icon-button rail-awake'
    this.el.dataset.testid = 'awake'
    this.el.append(icon('awake', 18))
    this.el.addEventListener('click', () => this.menu())
    void this.deps.get().then((s) => this.update(s))
  }

  update(s: AwakeState): void {
    this.state = s
    const t = this.deps.text()
    this.el.dataset.state = s.how === 'off' ? 'off' : s.holding ? 'on' : 'armed'
    const time = s.until ? new Date(s.until).toLocaleTimeString(this.deps.lang(), { hour: '2-digit', minute: '2-digit' }) : ''
    let label = s.how === 'off' ? t.nowOff : s.how === 'on' ? t.nowOn : s.how === 'until' ? t.nowUntil.replace('{time}', time) : s.holding ? t.nowBusy : t.nowBusyIdle
    if (s.holding && !s.granted) label += ` — ${t.notGranted}`
    this.el.title = label
    this.el.setAttribute('aria-label', label)
  }

  menu(): void {
    const t = this.deps.text()
    const s = this.state
    const set = (how: 'off' | 'on' | 'until' | 'busy', minutes?: number) => () => void this.deps.set(how, minutes ? { minutes } : {}).then((x) => this.update(x))
    const items: MenuItem[] = [
      { label: t.off, checked: s.how === 'off', testid: 'awake-off', action: set('off') },
      { label: t.on, checked: s.how === 'on', testid: 'awake-on', action: set('on') },
      ...[1, 2, 4].map((n) => ({ label: t.hours.replace('{n}', String(n)), testid: `awake-${n}h`, action: set('until', n * 60) })),
      { label: t.busy, checked: s.how === 'busy', testid: 'awake-busy', action: set('busy') },
      { separator: true, label: '', action: () => undefined },
      { label: t.display, checked: s.display, testid: 'awake-display', action: () => void this.deps.set('display', { display: !s.display }).then((x) => this.update(x)) },
      // Said where it matters: a Mac's closed lid is beyond a program's reach.
      ...(this.deps.mac ? [{ label: t.lid, disabled: true, action: () => undefined }] : []),
    ]
    popMenu(this.el, items, 'end')
  }
}
