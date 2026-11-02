/**
 * The graph of notes, beside the page: the notes of the project in view as
 * points, the links between them as lines — around the note in view (two
 * links away), or all of them. A point's size is its number of links; the
 * pointer on one lights it and its neighbours, a click opens it; the wheel
 * zooms, a drag moves the picture.
 */
import { iconButton } from './icons'
import { layout, neighbourhood, type Point } from './graphLayout'

export interface GraphText {
  title: string
  close: string
  local: string
  all: string
  empty: string
}

export interface GraphData {
  nodes: { rel: string; path: string; name: string }[]
  edges: [number, number][]
}

const SVG = 'http://www.w3.org/2000/svg'

export class GraphPanel {
  readonly el: HTMLElement
  private readonly svg: SVGSVGElement
  private readonly scene: SVGGElement
  private readonly status: HTMLElement
  private readonly modes: Record<'local' | 'all', HTMLButtonElement>
  private mode: 'local' | 'all' = 'local'
  private note: string | null = null
  private view = { x: 0, y: 0, scale: 1 }
  /** The positions drawn: the picture fitted again when the panel changes size. */
  private drawn: Point[] = []
  private seq = 0

  constructor(
    private text: GraphText,
    private readonly load: (note: string | null) => Promise<GraphData>,
    private readonly openNote: (path: string) => void,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'graph-panel'
    this.el.dataset.testid = 'graph-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'graph-title'
    const switcher = document.createElement('span')
    switcher.className = 'graph-modes'
    const mode = (m: 'local' | 'all'): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'graph-mode'
      b.dataset.testid = `graph-${m}`
      b.addEventListener('click', () => {
        this.mode = m
        void this.refresh()
      })
      switcher.append(b)
      return b
    }
    this.modes = { local: mode('local'), all: mode('all') }
    const close = iconButton('close', text.close, () => this.setVisible(false))
    header.append(title, switcher, close)
    this.status = document.createElement('div')
    this.status.className = 'graph-status'
    this.svg = document.createElementNS(SVG, 'svg')
    this.svg.classList.add('graph-svg')
    this.svg.dataset.testid = 'graph-svg'
    this.scene = document.createElementNS(SVG, 'g')
    this.svg.append(this.scene)
    this.el.append(header, this.status, this.svg)
    this.interact()
    // Shown or resized: the whole graph in view again.
    new ResizeObserver(() => {
      if (!this.el.hidden && this.drawn.length > 0) this.fit(this.drawn)
    }).observe(this.svg)
    this.setText(text)
  }

  setText(text: GraphText): void {
    this.text = text
    this.el.querySelector('.graph-title')!.textContent = text.title
    this.modes.local.textContent = text.local
    this.modes.all.textContent = text.all
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    this.onVisibility(on)
    if (on) void this.refresh()
  }

  /** The note in view: the graph is drawn around it. */
  show(note: string | null): void {
    if (note === this.note) return
    this.note = note
    void this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.el.hidden) return
    const seq = ++this.seq
    const data = await this.load(this.note)
    if (seq !== this.seq) return
    this.modes.local.setAttribute('aria-pressed', String(this.mode === 'local'))
    this.modes.all.setAttribute('aria-pressed', String(this.mode === 'all'))
    const center = this.note === null ? -1 : data.nodes.findIndex((n) => n.path === this.note)
    // Around the note in view: the notes two links away; all when there is none.
    const shown = this.mode === 'local' && center >= 0 ? [...neighbourhood(center, data.edges, 2)].sort((a, b) => a - b) : data.nodes.map((_, i) => i)
    const at = new Map(shown.map((n, i) => [n, i]))
    const edges = data.edges.filter(([a, b]) => at.has(a) && at.has(b)).map(([a, b]) => [at.get(a)!, at.get(b)!] as [number, number])
    this.status.textContent = shown.length === 0 ? this.text.empty : ''
    this.draw(shown.map((i) => data.nodes[i]!), edges, at.get(center) ?? -1)
  }

  private draw(nodes: GraphData['nodes'], edges: [number, number][], center: number): void {
    const pos = layout(nodes.length, edges)
    const degree = new Array<number>(nodes.length).fill(0)
    for (const [a, b] of edges) {
      degree[a]!++
      degree[b]!++
    }
    const near = nodes.map(() => new Set<number>())
    for (const [a, b] of edges) {
      near[a]!.add(b)
      near[b]!.add(a)
    }
    this.scene.replaceChildren()
    const lines = document.createElementNS(SVG, 'g')
    lines.classList.add('graph-edges')
    for (const [a, b] of edges) {
      const line = document.createElementNS(SVG, 'line')
      line.setAttribute('x1', String(pos[a]!.x))
      line.setAttribute('y1', String(pos[a]!.y))
      line.setAttribute('x2', String(pos[b]!.x))
      line.setAttribute('y2', String(pos[b]!.y))
      line.dataset.a = String(a)
      line.dataset.b = String(b)
      lines.append(line)
    }
    this.scene.append(lines)
    // Names on every point while there are few; otherwise on the note in view and under the pointer.
    const labels = nodes.length <= 30
    nodes.forEach((n, i) => {
      const g = document.createElementNS(SVG, 'g')
      g.classList.add('graph-node')
      if (i === center) g.classList.add('current')
      g.dataset.testid = 'graph-node'
      g.dataset.name = n.name
      g.setAttribute('transform', `translate(${pos[i]!.x} ${pos[i]!.y})`)
      const dot = document.createElementNS(SVG, 'circle')
      dot.setAttribute('r', String(0.12 + Math.sqrt(degree[i]!) * 0.06))
      const title = document.createElementNS(SVG, 'title')
      title.textContent = n.rel
      const label = document.createElementNS(SVG, 'text')
      label.textContent = n.name
      label.setAttribute('y', String(0.22 + Math.sqrt(degree[i]!) * 0.06 + 0.12))
      if (!labels && i !== center) label.classList.add('hidden')
      g.append(dot, title, label)
      g.addEventListener('mouseenter', () => this.light(i, near[i]!))
      g.addEventListener('mouseleave', () => this.light(-1, new Set()))
      g.addEventListener('click', (e) => {
        e.stopPropagation()
        this.openNote(n.path)
      })
      this.scene.append(g)
    })
    this.drawn = pos
    // After the panel is laid out: its size is known then.
    requestAnimationFrame(() => this.fit(pos))
  }

  /** A node and its neighbours lit, the rest dimmed; -1 lights none. */
  private light(node: number, near: Set<number>): void {
    this.svg.classList.toggle('lighting', node >= 0)
    ;[...this.scene.querySelectorAll<SVGGElement>('.graph-node')].forEach((g, i) => g.classList.toggle('lit', i === node || near.has(i)))
    for (const line of this.scene.querySelectorAll<SVGLineElement>('.graph-edges line')) {
      line.classList.toggle('lit', Number(line.dataset.a) === node || Number(line.dataset.b) === node)
    }
  }

  /** The whole graph in the panel, with a margin. */
  private fit(pos: Point[]): void {
    const box = this.svg.getBoundingClientRect()
    const w = box.width || 400
    const h = box.height || 400
    if (pos.length === 0) {
      this.view = { x: w / 2, y: h / 2, scale: 40 }
    } else {
      const xs = pos.map((p) => p.x)
      const ys = pos.map((p) => p.y)
      const minX = Math.min(...xs) - 1
      const maxX = Math.max(...xs) + 1
      const minY = Math.min(...ys) - 1
      const maxY = Math.max(...ys) + 1
      const scale = Math.min(w / (maxX - minX), h / (maxY - minY), 70)
      this.view = { x: w / 2 - ((minX + maxX) / 2) * scale, y: h / 2 - ((minY + maxY) / 2) * scale, scale }
    }
    this.apply()
  }

  private apply(): void {
    this.scene.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.scale})`)
    // Labels and lines keep their size on screen whatever the zoom.
    this.svg.style.setProperty('--graph-scale', String(this.view.scale))
  }

  /** The wheel zooms around the pointer; a drag on the picture moves it. */
  private interact(): void {
    this.svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const r = this.svg.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        const factor = Math.exp(-e.deltaY * 0.0015)
        const scale = Math.min(400, Math.max(5, this.view.scale * factor))
        const k = scale / this.view.scale
        this.view = { x: px - (px - this.view.x) * k, y: py - (py - this.view.y) * k, scale }
        this.apply()
      },
      { passive: false },
    )
    this.svg.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('.graph-node')) return
      const start = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y }
      this.svg.setPointerCapture(e.pointerId)
      this.svg.classList.add('dragging')
      const move = (m: PointerEvent): void => {
        this.view = { ...this.view, x: start.vx + m.clientX - start.x, y: start.vy + m.clientY - start.y }
        this.apply()
      }
      const up = (): void => {
        this.svg.classList.remove('dragging')
        this.svg.removeEventListener('pointermove', move)
        this.svg.removeEventListener('pointerup', up)
      }
      this.svg.addEventListener('pointermove', move)
      this.svg.addEventListener('pointerup', up)
    })
  }
}
