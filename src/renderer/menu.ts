/**
 * A small menu that opens from a button: items with an icon and a label, a
 * check mark for an option that is on. It closes on a choice, a click
 * elsewhere or Escape; arrows move between the items.
 */
import { icon, type IconName } from './icons'

export interface MenuItem {
  label: string
  icon?: IconName
  checked?: boolean
  testid?: string
  action: () => void
}

let open: { el: HTMLElement; close: () => void } | null = null

export function closeMenu(): void {
  open?.close()
}

export function popMenu(anchor: HTMLElement, items: MenuItem[], align: 'start' | 'end' = 'start'): void {
  closeMenu()
  const menu = document.createElement('div')
  menu.className = 'pop-menu'
  menu.setAttribute('role', 'menu')
  for (const item of items) {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox')
    if (item.checked !== undefined) b.setAttribute('aria-checked', String(item.checked))
    if (item.testid) b.dataset.testid = item.testid
    const mark = item.checked ? icon('check', 14) : item.icon ? icon(item.icon, 14) : document.createElement('span')
    mark.classList.add('mark')
    const label = document.createElement('span')
    label.textContent = item.label
    b.append(mark, label)
    b.addEventListener('click', () => {
      close()
      item.action()
    })
    menu.append(b)
  }
  document.body.append(menu)
  const r = anchor.getBoundingClientRect()
  const top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)
  const left = align === 'end' ? r.right - menu.offsetWidth : r.left
  menu.style.top = `${Math.max(8, top)}px`
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8))}px`
  anchor.setAttribute('aria-expanded', 'true')

  const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')]
  buttons[0]?.focus()
  const onKey = (e: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      anchor.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
    }
  }
  const onDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) close()
  }
  function close(): void {
    menu.remove()
    anchor.setAttribute('aria-expanded', 'false')
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('mousedown', onDown, true)
    if (open?.el === menu) open = null
  }
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('mousedown', onDown, true)
  open = { el: menu, close }
}
