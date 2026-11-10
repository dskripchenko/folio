/**
 * How documents are shown: the text's size and the page's width (settings, kept
 * per window), and a document's zoom when read — a pinch on the trackpad or
 * ⌘/Ctrl + the wheel, at the place under the pointer, so a part of a diagram
 * can be looked at closely. The zoom is the tab's own and is not kept.
 */
import { prefs } from './bridge'
import type { ViewPrefs } from './settingsDialog'

const KEY = 'view'
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 4

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export function viewPrefs(): ViewPrefs {
  const v = prefs.get<Partial<ViewPrefs>>(KEY, {})
  const size = typeof v.fontSize === 'number' && Number.isFinite(v.fontSize) ? v.fontSize : 16
  return { fontSize: clamp(Math.round(size), 12, 28), width: v.width === 'readable' ? 'readable' : 'full' }
}

/** The text's size and the width on the page: `--doc-scale` and `data-width` on the root. */
export function applyView(v: ViewPrefs = viewPrefs()): void {
  const root = document.documentElement
  root.style.setProperty('--doc-scale', String(v.fontSize / 16))
  root.dataset.width = v.width
}

export function setViewPrefs(change: Partial<ViewPrefs>): ViewPrefs {
  const v = { ...viewPrefs(), ...change }
  prefs.set(KEY, v)
  applyView(v)
  return v
}

/** The zoom one wheel or pinch event asks for: a pinch's small steps as they come, a wheel's notch as a step of about 10%. */
export function zoomStep(current: number, deltaY: number, deltaMode: number): number {
  const delta = deltaMode === 1 ? deltaY * 16 : deltaY
  const factor = clamp(Math.exp(-delta * 0.01), 0.9, 1.1)
  const next = current * factor
  // Close to 100% is 100%: the way back is easy to find.
  return clamp(Math.abs(next - 1) < 0.02 ? 1 : next, ZOOM_MIN, ZOOM_MAX)
}

/**
 * A document drawn at a zoom: laid out at the width it has at 100% and enlarged
 * as a whole (CSS `zoom`), so lines and diagrams keep their shape and the view
 * scrolls both ways. `width` is that width (the view's, or the reading column's).
 */
export function zoomDoc(el: HTMLElement, zoom: number, width: number): void {
  if (zoom === 1) {
    el.style.removeProperty('zoom')
    el.style.removeProperty('width')
    el.style.removeProperty('max-width')
    delete el.dataset.zoomed
    return
  }
  el.style.width = `${width}px`
  el.style.maxWidth = 'none'
  el.style.setProperty('zoom', String(zoom))
  el.dataset.zoomed = ''
}

/** The scroll that keeps the point at (`ax`, `ay`) in the scroller where it was through a zoom from `from` to `to`. */
export function anchoredScroll(scroll: { left: number; top: number }, ax: number, ay: number, from: number, to: number): { left: number; top: number } {
  return { left: ((scroll.left + ax) / from) * to - ax, top: ((scroll.top + ay) / from) * to - ay }
}
