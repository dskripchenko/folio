/**
 * Colours and groups in a row of tabs — the documents' and the consoles'
 * alike: a tab painted a colour of its own; groups with a chip before their
 * tabs (named in place, coloured, folded), the tabs of each kept together;
 * the menu items that do it. The host owns the tabs and the row, draws the
 * buttons and closes tabs; this keeps the row in order.
 */
import { TAB_COLORS, freeColor, groupAt, keepTogether, type GroupData, type TabColor } from '../common/tabGroups'
import { popMenuAt, type MenuItem } from './menu'

export interface TabMenuText {
  color: string
  noColor: string
  colors: Record<TabColor, string>
  newGroup: string
  addToGroup: string
  removeFromGroup: string
  unnamed: string
  groupName: string
  rename: string
  collapse: string
  expand: string
  ungroup: string
  closeGroup: string
  groupOf: string
}

export interface GroupedTab {
  color: TabColor | null
  group: string | null
  button: HTMLButtonElement
}

export interface TabGroup extends GroupData {
  chip: HTMLButtonElement
}

export interface GroupedTabsOptions<T extends GroupedTab> {
  /** The row's element and the tabs in it: the live list, put in order in place. */
  row: HTMLElement
  tabs: T[]
  text: () => TabMenuText
  /** The tab in use: it moves out of a group being folded. */
  active: () => T | null
  activate: (tab: T) => void
  /** Tabs closed together (a group's). */
  close: (tabs: readonly T[]) => void
  /** The row changed — the order, a colour, a group: the host keeps it. */
  changed: () => void
  /** The tab being dragged, when the host lets tabs be dragged: dropped on a chip, it joins the group. */
  dragged?: () => T | null
  /** Before the test ids (`console-`), when there is more than one row in the window. */
  testid?: string
}

export const SEPARATOR: MenuItem = { separator: true, label: '', action: () => undefined }

export const colorOf = (c: TabColor): string => `var(--tc-${c})`

export class GroupedTabs<T extends GroupedTab> {
  readonly groups = new Map<string, TabGroup>()

  constructor(private readonly o: GroupedTabsOptions<T>) {}

  private id(name: string): string {
    return `${this.o.testid ?? ''}${name}`
  }

  private get tabs(): T[] {
    return this.o.tabs
  }

  /** A tab's own colour on its button. */
  paint(tab: T): void {
    tab.button.classList.toggle('colored', tab.color !== null)
    if (tab.color) tab.button.style.setProperty('--tab-color', colorOf(tab.color))
    else tab.button.style.removeProperty('--tab-color')
    tab.button.dataset.color = tab.color ?? ''
  }

  /** A group as it was kept (a session restored). */
  restore(data: GroupData): TabGroup {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'tab-group'
    chip.dataset.testid = this.id('tab-group')
    const g: TabGroup = { ...data, chip }
    chip.addEventListener('click', () => this.toggle(g))
    chip.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.groupMenu(g, event.clientX, event.clientY)
    })
    // A tab dropped on the chip: into the group, at its end.
    chip.addEventListener('dragover', (event) => {
      if (!this.o.dragged?.()) return
      event.preventDefault()
      event.stopPropagation()
      chip.classList.add('drop-into')
    })
    chip.addEventListener('dragleave', () => chip.classList.remove('drop-into'))
    chip.addEventListener('drop', (event) => {
      chip.classList.remove('drop-into')
      const tab = this.o.dragged?.()
      if (!tab) return
      event.preventDefault()
      event.stopPropagation()
      this.join(tab, g)
    })
    this.groups.set(g.id, g)
    return g
  }

  /**
   * The row drawn again from the tabs: each group's tabs together after its
   * chip, folded ones hidden; a group left with no tabs gone.
   */
  layout(): void {
    const tabs = this.tabs
    tabs.splice(0, tabs.length, ...keepTogether(tabs))
    for (const tab of tabs) if (tab.group && !this.groups.has(tab.group)) tab.group = null
    for (const [id, g] of this.groups) {
      if (!tabs.some((x) => x.group === id)) {
        g.chip.remove()
        this.groups.delete(id)
      }
    }
    const row: HTMLElement[] = []
    tabs.forEach((tab, i) => {
      const g = tab.group ? this.groups.get(tab.group) : undefined
      if (g && tabs[i - 1]?.group !== g.id) row.push(g.chip)
      tab.button.hidden = !!g?.collapsed
      tab.button.classList.toggle('grouped', !!g)
      tab.button.classList.toggle('group-end', !!g && tabs[i + 1]?.group !== g.id)
      if (g) tab.button.style.setProperty('--group-color', colorOf(g.color))
      else tab.button.style.removeProperty('--group-color')
      tab.button.dataset.group = g?.id ?? ''
      row.push(tab.button)
    })
    const t = this.o.text()
    for (const g of this.groups.values()) {
      const n = tabs.filter((x) => x.group === g.id).length
      g.chip.textContent = g.name
      g.chip.classList.toggle('unnamed', g.name === '')
      g.chip.style.setProperty('--group-color', colorOf(g.color))
      g.chip.setAttribute('aria-expanded', String(!g.collapsed))
      g.chip.dataset.count = String(n)
      g.chip.title = t.groupOf.replace('{name}', g.name || t.unnamed).replace('{n}', String(n))
    }
    // Moved only where the order differs: a button being dragged or focused stays put.
    const el = this.o.row
    row.forEach((item, i) => {
      if (el.children[i] !== item) el.insertBefore(item, el.children[i] ?? null)
    })
    while (el.children.length > row.length) el.lastElementChild!.remove()
    this.o.changed()
  }

  /** A tab to another place in the row; dragged, it joins or leaves a group by where it lands. */
  move(tab: T, index: number, regroup = false): void {
    const tabs = this.tabs
    const from = tabs.indexOf(tab)
    if (from < 0) return
    tabs.splice(from, 1)
    tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab)
    if (regroup) tab.group = groupAt(tabs, tabs.indexOf(tab))
    this.layout()
  }

  /** A tab about to be used: its group, when folded, opens. */
  unfold(tab: T): void {
    const g = tab.group ? this.groups.get(tab.group) : undefined
    if (!g?.collapsed) return
    g.collapsed = false
    this.layout()
  }

  /** A new group of one tab, its name typed in place. */
  newGroup(tab: T): void {
    const g = this.restore({ id: crypto.randomUUID(), name: '', color: freeColor([...this.groups.values()].map((x) => x.color)), collapsed: false })
    tab.group = g.id
    this.layout()
    this.rename(g)
  }

  /** A tab into a group, after its last tab. */
  join(tab: T, g: TabGroup): void {
    const tabs = this.tabs
    const last = tabs.findLastIndex((x) => x.group === g.id && x !== tab)
    tab.group = g.id
    if (last < 0) return this.layout()
    const without = tabs.filter((x) => x !== tab)
    this.move(tab, without.indexOf(tabs[last]!) + 1)
  }

  /** A tab out of its group, after the group's last tab. */
  leave(tab: T): void {
    const end = this.tabs.findLastIndex((o) => o.group === tab.group)
    tab.group = null
    this.move(tab, end)
  }

  /** Folded (its tabs hidden) or opened; the tab in use moves out of a group being folded. */
  toggle(g: TabGroup): void {
    const tabs = this.tabs
    const active = this.o.active()
    if (!g.collapsed && active?.group === g.id) {
      const at = tabs.indexOf(active)
      const outside = [...tabs.slice(at), ...tabs.slice(0, at).reverse()].find((x) => x.group !== g.id && !(x.group && this.groups.get(x.group)?.collapsed))
      if (!outside) return
      g.collapsed = true
      this.o.activate(outside)
    } else g.collapsed = !g.collapsed
    this.layout()
  }

  /** The group's name edited in its chip: Enter or leaving keeps it, Escape does not. */
  rename(g: TabGroup): void {
    const input = document.createElement('input')
    input.className = 'tab-group-input'
    input.dataset.testid = this.id('tab-group-name')
    input.value = g.name
    input.placeholder = this.o.text().groupName
    input.spellcheck = false
    let done = false
    const end = (keep: boolean) => {
      if (done) return
      done = true
      if (keep) g.name = input.value.trim().slice(0, 80)
      input.remove()
      g.chip.hidden = false
      this.layout()
    }
    for (const type of ['click', 'mousedown', 'dblclick'] as const) input.addEventListener(type, (e) => e.stopPropagation())
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') end(true)
      else if (e.key === 'Escape') end(false)
    })
    input.addEventListener('blur', () => end(true))
    g.chip.hidden = true
    g.chip.after(input)
    input.style.setProperty('--group-color', colorOf(g.color))
    input.focus()
    input.select()
  }

  private colorItems(current: TabColor | null, set: (c: TabColor | null) => void, none: boolean): MenuItem[] {
    const t = this.o.text()
    return [
      ...(none ? [{ label: t.noColor, testid: this.id('color-none'), checked: current === null, action: () => set(null) }] : []),
      ...TAB_COLORS.map((c) => ({ label: t.colors[c], testid: this.id(`color-${c}`), swatch: colorOf(c), checked: current === c, action: () => set(c) })),
    ]
  }

  /** A tab's menu items: its colour, a group to make, join or leave. */
  tabItems(tab: T, x: number, y: number): MenuItem[] {
    const m = this.o.text()
    const others = [...this.groups.values()].filter((g) => g.id !== tab.group)
    return [
      { label: `${m.color}…`, testid: this.id('tab-color'), swatch: tab.color ? colorOf(tab.color) : undefined, action: () => popMenuAt(x, y, this.colorItems(tab.color, (c) => {
        tab.color = c
        this.paint(tab)
        this.o.changed()
      }, true)) },
      { label: m.newGroup, testid: this.id('tab-new-group'), action: () => this.newGroup(tab) },
      ...(others.length > 0
        ? [{ label: `${m.addToGroup}…`, testid: this.id('tab-add-to-group'), action: () => popMenuAt(x, y, others.map((g) => ({ label: g.name || m.unnamed, swatch: colorOf(g.color), testid: this.id('group-choice'), action: () => this.join(tab, g) }))) }]
        : []),
      ...(tab.group ? [{ label: m.removeFromGroup, testid: this.id('tab-ungroup'), action: () => this.leave(tab) }] : []),
    ]
  }

  groupMenu(g: TabGroup, x: number, y: number): void {
    const m = this.o.text()
    popMenuAt(x, y, [
      { label: m.rename, testid: this.id('group-rename'), action: () => this.rename(g) },
      { label: `${m.color}…`, testid: this.id('group-color'), swatch: colorOf(g.color), action: () => popMenuAt(x, y, this.colorItems(g.color, (c) => {
        g.color = c ?? g.color
        this.layout()
      }, false)) },
      { label: g.collapsed ? m.expand : m.collapse, testid: this.id('group-toggle'), action: () => this.toggle(g) },
      SEPARATOR,
      { label: m.ungroup, testid: this.id('group-ungroup'), action: () => {
        for (const tab of this.tabs) if (tab.group === g.id) tab.group = null
        this.layout()
      } },
      { label: m.closeGroup, testid: this.id('group-close'), action: () => this.o.close(this.tabs.filter((o) => o.group === g.id)) },
    ])
  }
}
