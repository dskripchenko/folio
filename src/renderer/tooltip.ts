// The app's own tooltips. Electron does not always show the system's tooltip for `title` (on macOS often not at
// all), so a button that is only an icon would say nothing until pressed. Shown here instead: an element's
// `title`, or a button's `aria-label` when it has no title (a ×, an arrow, an embed's icon).

const DELAY = 450
const GAP = 6

let tip: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined
/** The element hovered and its title, taken off while the tip shows so the system's does not show too. */
let current: { el: HTMLElement; title: string | null } | null = null

function tipEl(): HTMLElement {
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'app-tip'
    tip.setAttribute('role', 'tooltip')
    tip.hidden = true
    document.body.append(tip)
  }
  return tip
}

/** The nearest element on the path that has something to say, and what. */
function target(event: Event): { el: HTMLElement; text: string } | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue
    if (node === document.body) return null
    const title = node.getAttribute('title')
    if (title?.trim()) return { el: node, text: title.trim() }
    const label = node.getAttribute('aria-label')
    if (label?.trim() && (node.tagName === 'BUTTON' || node.getAttribute('role') === 'button')) return { el: node, text: label.trim() }
  }
  return null
}

function place(el: HTMLElement, box: HTMLElement): void {
  const r = el.getBoundingClientRect()
  const w = box.offsetWidth
  const h = box.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Below, centred; above when there is no room; beside a narrow rail at the window's edge.
  let left = r.left + r.width / 2 - w / 2
  let top = r.bottom + GAP
  if (top + h > vh - 4) top = r.top - h - GAP
  if (r.right > vw - 60 && r.width < 60) {
    left = r.left - w - GAP
    top = r.top + r.height / 2 - h / 2
  } else if (r.left < 60 && r.width < 60) {
    left = r.right + GAP
    top = r.top + r.height / 2 - h / 2
  }
  box.style.left = `${Math.max(4, Math.min(left, vw - w - 4))}px`
  box.style.top = `${Math.max(4, Math.min(top, vh - h - 4))}px`
}

export function hideTip(): void {
  clearTimeout(timer)
  timer = undefined
  if (tip) tip.hidden = true
  if (current) {
    // Its title back, unless something set a new one meanwhile.
    if (current.title !== null && !current.el.hasAttribute('title')) current.el.setAttribute('title', current.title)
    current = null
  }
}

export function installTooltips(): void {
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return
    const found = target(event)
    if (found?.el === current?.el) return
    hideTip()
    if (!found) return
    const title = found.el.getAttribute('title')
    if (title !== null) found.el.removeAttribute('title')
    current = { el: found.el, title }
    timer = setTimeout(() => {
      if (!current || !current.el.isConnected) return
      const box = tipEl()
      box.textContent = found.text
      box.hidden = false
      place(current.el, box)
    }, DELAY)
  })
  document.addEventListener('pointerout', (event) => {
    if (!current) return
    const to = event.relatedTarget as Node | null
    if (to && (current.el === to || current.el.contains(to))) return
    hideTip()
  })
  for (const type of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(type, hideTip, { capture: true, passive: true })
  window.addEventListener('blur', hideTip)
}
