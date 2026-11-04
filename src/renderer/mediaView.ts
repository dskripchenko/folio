/**
 * Pictures, video and sound shown in folio's own tab instead of the system's
 * program: a picture fitted to the view or at its own size, zoomed with
 * Cmd/Ctrl and the wheel (or a pinch) about the pointer, dragged when larger
 * than the view, transparency over a chequerboard; video and sound in the
 * kit's players (`<dsk-video>`, `<dsk-audio>`), seeking in the file.
 */
import { icon } from './icons'

export interface MediaText {
  zoomIn: string
  zoomOut: string
  fit: string
  actual: string
  external: string
  failed: string
}

/** What the status line tells of a shown file. */
export interface MediaInfo {
  width?: number
  height?: number
  /** Seconds, for video and sound. */
  duration?: number
}

export interface MediaOptions {
  /** The file's URL in the folio scheme. */
  src: string
  name: string
  text: MediaText
  /** The file opened in the system's program. */
  external(): void
  /** Its size and length, once known. */
  info(info: MediaInfo): void
}

const MIN = 0.02
const MAX = 32

/** A picture to look at: fitted, zoomed about the pointer, dragged. */
export function imageView(o: MediaOptions): HTMLElement {
  const root = document.createElement('div')
  root.className = 'media-view image-view'
  const stage = document.createElement('div')
  stage.className = 'image-stage'
  stage.tabIndex = 0
  stage.dataset.testid = 'image-stage'
  const canvas = document.createElement('div')
  canvas.className = 'image-canvas'
  const img = document.createElement('img')
  img.alt = o.name
  img.draggable = false
  img.dataset.testid = 'media-image'
  canvas.append(img)
  stage.append(canvas)

  const label = document.createElement('button')
  label.type = 'button'
  label.className = 'media-zoom'
  label.dataset.testid = 'image-zoom'
  label.title = o.text.fit

  /** Its own size (an SVG without one: the view's). */
  let natural = { w: 0, h: 0 }
  let scale = 1
  let fitted = true

  const fitScale = (): number => {
    // The view's whole box, scroll bars or not: fitting does not depend on whether they show now.
    const w = stage.offsetWidth - 32
    const h = stage.offsetHeight - 32
    if (!natural.w || !natural.h || w <= 0 || h <= 0) return 1
    // A small picture stays at its own size; a big one fits.
    return Math.min(1, w / natural.w, h / natural.h)
  }

  const apply = (): void => {
    img.style.width = `${natural.w * scale}px`
    img.style.height = `${natural.h * scale}px`
    img.style.imageRendering = scale >= 2 ? 'pixelated' : ''
    label.textContent = `${Math.round(scale * 100)}%`
    root.dataset.zoom = String(Math.round(scale * 1000) / 1000)
    stage.classList.toggle('image-stage--pan', canvas.scrollWidth > stage.clientWidth || canvas.scrollHeight > stage.clientHeight)
  }

  /** To a scale, the point under (x, y) — the view's middle by default — staying where it is. */
  const zoomTo = (next: number, x?: number, y?: number): void => {
    next = Math.min(MAX, Math.max(MIN, next))
    const box = stage.getBoundingClientRect()
    const px = x ?? box.left + box.width / 2
    const py = y ?? box.top + box.height / 2
    const before = img.getBoundingClientRect()
    const ix = (px - before.left) / scale
    const iy = (py - before.top) / scale
    scale = next
    fitted = false
    apply()
    const after = img.getBoundingClientRect()
    stage.scrollLeft += after.left + ix * scale - px
    stage.scrollTop += after.top + iy * scale - py
  }

  const fit = (): void => {
    scale = fitScale()
    fitted = true
    apply()
  }

  const button = (name: Parameters<typeof icon>[0], title: string, testid: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    b.dataset.testid = testid
    b.append(icon(name))
    b.addEventListener('click', run)
    return b
  }
  label.addEventListener('click', fit)
  const actual = document.createElement('button')
  actual.type = 'button'
  actual.textContent = '1:1'
  actual.title = o.text.actual
  actual.dataset.testid = 'image-actual'
  actual.addEventListener('click', () => zoomTo(1))
  const bar = mediaBar(o, [
    button('minus', o.text.zoomOut, 'image-zoom-out', () => zoomTo(scale / 1.25)),
    label,
    button('plus', o.text.zoomIn, 'image-zoom-in', () => zoomTo(scale * 1.25)),
    actual,
  ])
  root.append(stage, bar)

  img.addEventListener('load', () => {
    natural = { w: img.naturalWidth || stage.clientWidth, h: img.naturalHeight || stage.clientHeight }
    fit()
    o.info({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined })
  })
  img.addEventListener('error', () => root.replaceChildren(failed(o), bar))
  img.src = o.src

  // Cmd/Ctrl and the wheel, or a pinch (a wheel with Ctrl): zoom about the pointer; the wheel alone scrolls.
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(scale * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), e.clientX, e.clientY)
    },
    { passive: false },
  )
  // A double click: its own size at the point, or fitted again.
  stage.addEventListener('dblclick', (e) => (fitted && Math.abs(scale - 1) > 0.001 ? zoomTo(1, e.clientX, e.clientY) : fit()))
  // Dragged when larger than the view.
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !stage.classList.contains('image-stage--pan')) return
    const start = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop }
    stage.setPointerCapture(e.pointerId)
    stage.classList.add('image-stage--dragging')
    const move = (m: PointerEvent) => {
      stage.scrollLeft = start.left - (m.clientX - start.x)
      stage.scrollTop = start.top - (m.clientY - start.y)
    }
    const up = () => {
      stage.classList.remove('image-stage--dragging')
      stage.removeEventListener('pointermove', move)
      stage.removeEventListener('pointerup', up)
      stage.removeEventListener('pointercancel', up)
    }
    stage.addEventListener('pointermove', move)
    stage.addEventListener('pointerup', up)
    stage.addEventListener('pointercancel', up)
  })
  // Keys as in image viewers: + and − zoom, 0 fits, 1 is its own size.
  stage.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const keys: Record<string, () => void> = {
      '+': () => zoomTo(scale * 1.25),
      '=': () => zoomTo(scale * 1.25),
      '-': () => zoomTo(scale / 1.25),
      '0': fit,
      '1': () => zoomTo(1),
    }
    const run = keys[e.key]
    if (!run) return
    e.preventDefault()
    run()
  })
  // The view resized: a fitted picture fits again.
  new ResizeObserver(() => {
    if (fitted && natural.w) fit()
  }).observe(stage)
  return root
}

/** A video in the kit's player, as large as the view lets it be. */
export function videoView(o: MediaOptions): HTMLElement {
  const root = document.createElement('div')
  root.className = 'media-view video-view'
  const player = document.createElement('dsk-video')
  player.setAttribute('src', o.src)
  player.setAttribute('label', o.name)
  player.setAttribute('preload', 'metadata')
  watchMedia(player, o)
  const box = document.createElement('div')
  box.className = 'media-player'
  box.append(player)
  root.append(box, mediaBar(o, []))
  return root
}

/** A sound in the kit's player, with its waveform. */
export function audioView(o: MediaOptions): HTMLElement {
  const root = document.createElement('div')
  root.className = 'media-view audio-view'
  const player = document.createElement('dsk-audio')
  player.setAttribute('src', o.src)
  player.setAttribute('track-title', o.name)
  player.setAttribute('preload', 'metadata')
  player.setAttribute('waveform', '')
  player.setAttribute('show-rate', '')
  watchMedia(player, o)
  const box = document.createElement('div')
  box.className = 'media-player'
  box.append(player)
  root.append(box, mediaBar(o, []))
  return root
}

/**
 * A PDF in Chromium's own viewer (pages, zoom, search, its outline, printing):
 * framed from the one path the window may frame, which gives PDFs only.
 */
export function pdfView(o: MediaOptions): HTMLElement {
  const root = document.createElement('div')
  root.className = 'media-view pdf-view'
  const frame = document.createElement('iframe')
  frame.className = 'pdf-frame'
  frame.dataset.testid = 'pdf-frame'
  frame.title = o.name
  // From `folio://app/r/<root>/…` to `folio://app/pdf/<root>/…`.
  frame.src = o.src.replace(/^folio:\/\/app\/r\//, 'folio://app/pdf/')
  root.append(frame, mediaBar(o, []))
  return root
}

/** The player's media element once it is there: its size and length for the status line. */
function watchMedia(player: HTMLElement, o: MediaOptions): void {
  const told = (m: HTMLMediaElement) => {
    const v = m as HTMLVideoElement
    o.info({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(m.duration) ? m.duration : undefined })
  }
  // The element is drawn by the player inside it; its events bubble to the player only when composed, so they are caught on the way down.
  player.addEventListener('loadedmetadata', (e) => told(e.target as HTMLMediaElement), true)
  player.addEventListener(
    'error',
    (e) => {
      if (!(e.target instanceof HTMLMediaElement)) return
      player.closest('.media-view')?.querySelector('.media-player')?.replaceChildren(failed(o))
    },
    true,
  )
}

/** The bar under the file: its own controls, then opening it in the system's program. */
function mediaBar(o: MediaOptions, controls: HTMLElement[]): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'media-bar'
  const external = document.createElement('button')
  external.type = 'button'
  external.title = o.text.external
  external.setAttribute('aria-label', o.text.external)
  external.dataset.testid = 'media-external'
  external.append(icon('external'))
  external.addEventListener('click', () => o.external())
  bar.append(...controls, external)
  return bar
}

/** A file Chromium cannot decode (a codec it lacks, a broken file): said so, the system's program offered. */
function failed(o: MediaOptions): HTMLElement {
  const box = document.createElement('div')
  box.className = 'media-failed'
  box.dataset.testid = 'media-failed'
  const p = document.createElement('p')
  p.textContent = o.text.failed.replace('{name}', o.name)
  const open = document.createElement('button')
  open.type = 'button'
  open.textContent = o.text.external
  open.addEventListener('click', () => o.external())
  box.append(p, open)
  return box
}

/** A size in bytes as people read it. */
export function bytes(n: number, lang: string): string {
  const units = lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] : ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: i === 0 || n >= 100 ? 0 : 1 }).format(n)} ${units[i]}`
}

/** A length in seconds as `m:ss` or `h:mm:ss`. */
export function duration(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (x: number) => String(x).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}
