/**
 * Consoles: a panel under the page (or beside it) of tabs, each holding one
 * shell or two side by side, drawn by `@dskripchenko/terminal`. With the
 * shell's integration the tabs say what runs and how it ended, a mark beside
 * each command says it too; paths in the output open in folio at their line;
 * files dropped in are typed as paths; Cmd+F finds in the output.
 */
import { Terminal, TerminalView, type TerminalTheme } from '@dskripchenko/terminal'
import type { TabColor } from '../common/tabGroups'
import type { FindTarget } from './find'
import { GroupedTabs, SEPARATOR, type TabMenuText } from './groupedTabs'
import { icon, iconButton, type IconName } from './icons'
import { popMenuAt, type MenuItem } from './menu'

export interface ConsoleText {
  title: string
  newConsole: string
  close: string
  hide: string
  ended: string
  failed: string
  split: string
  toRight: string
  toBottom: string
  maximize: string
  restore: string
  copy: string
  paste: string
  selectAll: string
  clear: string
  find: string
  closePane: string
  running: string
  /** The tabs' colours and groups, and closing many: the documents' tabs' words. */
  tabMenu: TabMenuText & { closeOthers: string; closeRight: string; closeAll: string }
}

export interface ConsoleBridge {
  /** A shell in a folder; with a command, one that runs it and ends with it (a task). */
  open(cwd: string | null, cols: number, rows: number, command?: string): Promise<{ id: number; cwd: string } | { error: string }>
  input(id: number, data: string): void
  resize(id: number, cols: number, rows: number): void
  close(id: number): void
  onData(callback: (id: number, data: string) => void): void
  onExit(callback: (id: number, code: number) => void): void
  /** Open a web address in the system's browser. */
  external(url: string): void
  /** A path from the output, from the console's folder: the file, or null. */
  resolve(cwd: string, text: string): Promise<{ path: string; line: number | null } | null>
  /** Open a file in folio (at a line). */
  openFile(path: string, line: number | null): void
  /** A dropped file's path on disk. */
  pathOf(file: File): string | null
  platform: string
  /** Opens the find bar over the output. */
  find(): void
}

/** Colours made for reading output: calmer than a terminal's defaults, the panel in the same tone. */
const LIGHT: TerminalTheme = {
  foreground: '#383a42',
  background: '#fafafa',
  cursor: '#526eff',
  selection: 'rgba(82, 110, 255, 0.22)',
  ansi: ['#383a42', '#e45649', '#50a14f', '#c18401', '#4078f2', '#a626a4', '#0184bc', '#a0a1a7', '#696c77', '#d73a49', '#22863a', '#b08800', '#2f6fdd', '#b048c0', '#1b8fb8', '#ffffff'],
}
const DARK: TerminalTheme = {
  foreground: '#c8ccd4',
  background: '#161b22',
  cursor: '#61afef',
  selection: 'rgba(97, 175, 239, 0.3)',
  ansi: ['#3f4451', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d7dae0', '#5c6370', '#ff7b86', '#b5e890', '#f0d197', '#8cc8ff', '#de9ef0', '#7fd6e0', '#ffffff'],
}

/** Paths in output: `src/a.ts:12:3`, `./x`, `../y/z.md`, `/abs/path`, `~/notes.md`, `file.py:40`. */
const PATH = /(?:~|\.{1,2})?(?:[\\/][\w.@+-]+)+(?::\d+(?::\d+)?)?|[\w.@+-]+(?:[\\/][\w.@+-]+)+(?::\d+(?::\d+)?)?|[\w@+-][\w.@+-]*\.[A-Za-z]\w*:\d+(?::\d+)?/g

interface Pane {
  id: number | null
  term: Terminal
  view: TerminalView
  el: HTMLElement
  cwd: string
  ended: boolean
}

interface Group {
  panes: Pane[]
  active: Pane
  el: HTMLElement
  button: HTMLButtonElement
  label: HTMLElement
  activity: boolean
  /** A task's name: the tab's label, whatever runs in it. */
  task?: string
  /** Its own colour, and the group of tabs it is in. */
  color: TabColor | null
  group: string | null
}

type Position = 'bottom' | 'right'

const STORE = 'folio.console'

const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/** A path as a shell reads it: quoted when it has to be. */
function quote(path: string, windows: boolean): string {
  if (/^[\w@%+=:,./\\-]+$/.test(path)) return path
  return windows ? `"${path}"` : `'${path.replace(/'/g, `'\\''`)}'`
}

export class ConsolePanel {
  readonly el: HTMLElement
  private readonly tabsEl: HTMLElement
  private readonly body: HTMLElement
  private readonly groups: Group[] = []
  private active: Group | null = null
  /** The tabs' colours and groups, as the documents' tabs have them. */
  private readonly grouped: GroupedTabs<Group>
  private dark = false
  private position: Position = 'bottom'
  private size: Record<Position, number> = { bottom: 300, right: 520 }
  private readonly buttons: Record<'split' | 'position' | 'maximize', HTMLButtonElement>
  /** Where the keyboard was last: in a console, or elsewhere — what Cmd+F finds in. */
  private lastFocusIn = false

  constructor(
    private text: ConsoleText,
    private readonly bridge: ConsoleBridge,
    private readonly onVisibility: () => void,
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { position?: Position; size?: Record<Position, number> }
      if (saved.position === 'right') this.position = 'right'
      if (saved.size) this.size = { ...this.size, ...saved.size }
    } catch {
      /* the defaults */
    }
    this.el = document.createElement('section')
    this.el.className = 'console-panel'
    this.el.dataset.testid = 'console-panel'
    this.el.hidden = true
    const grip = document.createElement('div')
    grip.className = 'console-grip'
    grip.setAttribute('role', 'separator')
    const head = document.createElement('header')
    this.tabsEl = document.createElement('div')
    this.tabsEl.className = 'console-tabs'
    this.tabsEl.setAttribute('role', 'tablist')
    this.grouped = new GroupedTabs<Group>({
      row: this.tabsEl,
      tabs: this.groups,
      text: () => this.text.tabMenu,
      active: () => this.active,
      activate: (g) => this.activate(g),
      close: (list) => {
        for (const g of [...list]) this.closeGroup(g)
      },
      changed: () => undefined,
      testid: 'console-',
    })
    const add = iconButton('plus', text.newConsole, () => void this.open(this.active?.active.cwd ?? null))
    add.dataset.testid = 'console-new'
    this.buttons = {
      split: iconButton('split', text.split, () => void this.split()),
      position: iconButton('panelRight', text.toRight, () => this.setPosition(this.position === 'bottom' ? 'right' : 'bottom')),
      maximize: iconButton('maximize', text.maximize, () => this.toggleMaximized()),
    }
    this.buttons.split.dataset.testid = 'console-split'
    this.buttons.position.dataset.testid = 'console-position'
    this.buttons.maximize.dataset.testid = 'console-maximize'
    const hide = iconButton('down', text.hide, () => this.setVisible(false))
    hide.dataset.testid = 'console-hide'
    head.append(this.tabsEl, add, this.buttons.split, this.buttons.position, this.buttons.maximize, hide)
    this.body = document.createElement('div')
    this.body.className = 'console-body'
    this.el.append(grip, head, this.body)
    this.applyTheme()

    grip.addEventListener('pointerdown', (e) => this.drag(e, grip))
    bridge.onData((id, data) => {
      const found = this.paneOf(id)
      if (!found) return
      found.pane.term.write(data)
      // Output in a tab not in view: a dot on the tab.
      if ((found.group !== this.active || this.el.hidden) && !found.group.activity) {
        found.group.activity = true
        this.decorate(found.group)
      }
    })
    bridge.onExit((id, code) => {
      const found = this.paneOf(id)
      if (!found) return
      found.pane.ended = true
      found.pane.term.write(`\r\n\x1b[2m${this.text.ended.replace('{code}', String(code))}\x1b[0m\r\n`)
      this.decorate(found.group)
    })
    // What Cmd+F finds in: the output when the keyboard was last in a console.
    document.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('.find-bar')) return
      this.lastFocusIn = this.el.contains(t)
    })
    this.el.addEventListener('keydown', (e) => this.onKey(e), true)
  }

  setText(text: ConsoleText): void {
    this.text = text
    this.syncButtons()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  get count(): number {
    return this.groups.length
  }

  setVisible(visible: boolean): void {
    if (this.el.hidden === !visible) return
    this.el.hidden = !visible
    if (!visible) document.body.classList.remove('console-max')
    this.place()
    if (visible && this.active) {
      this.active.activity = false
      this.decorate(this.active)
      this.fitAll()
      this.active.active.view.focus()
    }
    this.onVisibility()
  }

  /** Ctrl+`: a console if there is none, else the panel shown or hidden. */
  toggle(cwd: string | null): void {
    if (this.groups.length === 0) void this.open(cwd)
    else this.setVisible(!this.visible)
  }

  setDark(dark: boolean): void {
    this.dark = dark
    this.applyTheme()
  }

  /** The output to find in, when the keyboard was last in a console. */
  findTarget(): FindTarget | null {
    if (!this.lastFocusIn || this.el.hidden || !this.active) return null
    const view = this.active.active.view
    return { search: (p) => view.find(p), show: (i, reveal) => view.showMatch(i, reveal), clear: () => view.clearFind() }
  }

  focusActive(): void {
    this.active?.active.view.focus()
  }

  /** A new console in a folder (null: Shared), in a tab of its own. */
  /**
   * The consoles open (a split one: each of its panes), for sending text to one
   * (ADR-006, R5): its folder and what runs in it now.
   */
  targets(): { id: number; label: string; cwd: string; running: string | null }[] {
    const out: { id: number; label: string; cwd: string; running: string | null }[] = []
    for (const g of this.groups) {
      for (const p of g.panes) {
        if (p.id === null || p.ended) continue
        const last = p.term.lastCommand
        const running = last && last.output !== undefined && last.end === undefined ? (last.text ?? null) : null
        out.push({ id: p.id, label: g.label.textContent ?? '', cwd: p.cwd, running })
      }
    }
    return out
  }

  /**
   * Text into a console as a paste — not sent: Enter is the reader's to press.
   * Lines go only to a program that takes a paste as one (bracketed paste):
   * elsewhere each line would run as a command. The console comes into view.
   */
  pasteTo(id: number, text: string): 'ok' | 'gone' | 'unsafe' {
    const found = this.paneOf(id)
    if (!found || found.pane.ended) return 'gone'
    if (text.includes('\n') && !found.pane.term.bracketedPaste) return 'unsafe'
    this.setVisible(true)
    this.activate(found.group)
    found.group.active = found.pane
    this.markActivePane(found.group)
    found.pane.term.paste(text)
    found.pane.view.focus()
    return 'ok'
  }

  async open(cwd: string | null): Promise<void> {
    await this.openGroup(cwd)
  }

  /**
   * A task: its command run in a console of its own in the folder, the tab
   * named after it, ending when the command does. The console's id, to follow
   * its output; null when it did not start.
   */
  async run(cwd: string, command: string, name: string): Promise<number | null> {
    return this.openGroup(cwd, { command, name })
  }

  private async openGroup(cwd: string | null, task?: { command: string; name: string }): Promise<number | null> {
    this.setVisible(true)
    const el = document.createElement('div')
    el.className = 'console-group'
    const button = document.createElement('button')
    const label = document.createElement('span')
    const group: Group = { panes: [], active: null as unknown as Pane, el, button, label, activity: false, color: null, group: null, ...(task ? { task: task.name } : {}) }
    button.type = 'button'
    button.className = 'console-tab'
    button.setAttribute('role', 'tab')
    button.dataset.testid = 'console-tab'
    label.className = 'console-tab-label'
    const status = document.createElement('span')
    status.className = 'console-tab-status'
    const close = document.createElement('span')
    close.className = 'console-tab-close'
    close.setAttribute('role', 'button')
    close.title = this.text.close
    close.append(icon('close', 12))
    button.append(status, label, close)
    button.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.console-tab-close')) this.closeGroup(group)
      else this.activate(group)
    })
    button.addEventListener('auxclick', (e) => {
      if (e.button === 1) this.closeGroup(group)
    })
    // Its menu: a colour, a group; it and others closed.
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.tabMenu(group, e.clientX, e.clientY)
    })
    this.tabsEl.append(button)
    this.body.append(el)
    this.groups.push(group)
    this.grouped.layout()
    this.activate(group)
    return this.addPane(group, cwd, task?.command)
  }

  /** A second console beside the one in front, in its folder. */
  async split(): Promise<void> {
    const g = this.active
    if (!g) return void this.open(null)
    if (g.panes.length >= 2) return
    await this.addPane(g, g.active.cwd || null)
  }

  // Panes -----------------------------------------------------------------------------------

  private async addPane(group: Group, cwd: string | null, command?: string): Promise<number | null> {
    const el = document.createElement('div')
    el.className = 'console-pane'
    el.dataset.testid = 'console'
    group.el.append(el)
    const t = this.dark ? DARK : LIGHT
    const term = new Terminal({ scrollback: 10_000, foreground: t.foreground, background: t.background })
    const pane: Pane = { id: null, term, view: null as unknown as TerminalView, el, cwd: cwd ?? '', ended: false }
    pane.view = new TerminalView(term, el, {
      theme: t,
      fontSize: 12.5,
      onResize: (cols, rows) => pane.id !== null && this.bridge.resize(pane.id, cols, rows),
      onLink: (url) => {
        if (/^(https?:|mailto:)/i.test(url)) this.bridge.external(url)
      },
      links: [{ pattern: PATH, activate: (text) => void this.openPath(pane, text) }],
    })
    term.onData((data) => pane.id !== null && !pane.ended && this.bridge.input(pane.id, data))
    term.onTitle(() => this.decorate(group))
    term.onCwd((dir) => {
      // A Windows folder comes as /C:/Users/…
      pane.cwd = dir.replace(/^\/([A-Za-z]:)/, '$1')
      this.decorate(group)
    })
    term.onCommand(() => this.decorate(group))
    term.onBell(() => {
      group.button.classList.remove('bell')
      void group.button.offsetWidth
      group.button.classList.add('bell')
    })
    el.addEventListener('mousedown', () => {
      group.active = pane
      this.markActivePane(group)
    })
    el.addEventListener('contextmenu', (e) => {
      if (term.mouseTracking !== 'none' && !e.shiftKey) return
      e.preventDefault()
      group.active = pane
      this.markActivePane(group)
      this.menu(pane, e.clientX, e.clientY)
    })
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer) return
      const types = [...e.dataTransfer.types]
      if (types.includes('Files') || types.includes('application/x-folio-path')) {
        e.preventDefault()
        el.classList.add('dropping')
      }
    })
    el.addEventListener('dragleave', () => el.classList.remove('dropping'))
    el.addEventListener('drop', (e) => {
      el.classList.remove('dropping')
      if (!e.dataTransfer) return
      e.preventDefault()
      const own = e.dataTransfer.getData('application/x-folio-path')
      const paths = own ? own.split('\n').filter(Boolean) : [...e.dataTransfer.files].map((f) => this.bridge.pathOf(f)).filter((p): p is string => !!p)
      if (paths.length === 0) return
      term.input(paths.map((p) => quote(p, this.bridge.platform === 'win32')).join(' ') + ' ')
      pane.view.focus()
    })
    group.panes.push(pane)
    group.active = pane
    this.markActivePane(group)
    this.syncButtons()
    // The new console has the keyboard (after a split, the button had it).
    requestAnimationFrame(() => {
      this.fitAll()
      if (this.active === group) pane.view.focus()
    })
    const { cols, rows } = pane.view.fit()
    // A task's command shown first, as if typed.
    if (command !== undefined) term.write(`\x1b[2m$ ${command}\x1b[0m\r\n`)
    const opened = await this.bridge.open(cwd, cols, rows, command)
    if ('error' in opened) {
      pane.ended = true
      term.write(`\x1b[31m${this.text.failed.replace('{error}', opened.error)}\x1b[0m\r\n`)
      this.decorate(group)
      return null
    }
    pane.id = opened.id
    pane.cwd = opened.cwd
    this.decorate(group)
    this.bridge.resize(opened.id, term.cols, term.rows)
    return opened.id
  }

  private closePane(group: Group, pane: Pane): void {
    if (pane.id !== null) this.bridge.close(pane.id)
    pane.view.dispose()
    pane.el.remove()
    group.panes.splice(group.panes.indexOf(pane), 1)
    if (group.panes.length === 0) return this.closeGroup(group)
    group.active = group.panes[0]!
    this.markActivePane(group)
    this.decorate(group)
    this.syncButtons()
    requestAnimationFrame(() => this.fitAll())
  }

  private closeGroup(group: Group): void {
    for (const p of group.panes) {
      if (p.id !== null) this.bridge.close(p.id)
      p.view.dispose()
    }
    group.el.remove()
    group.button.remove()
    const i = this.groups.indexOf(group)
    this.groups.splice(i, 1)
    this.grouped.layout()
    if (this.active === group) {
      const next = this.groups[Math.min(i, this.groups.length - 1)] ?? null
      if (next) this.activate(next)
      else {
        this.active = null
        this.setVisible(false)
      }
    }
    this.syncButtons()
  }

  private paneOf(id: number): { group: Group; pane: Pane } | null {
    for (const group of this.groups) for (const pane of group.panes) if (pane.id === id) return { group, pane }
    return null
  }

  private activate(group: Group): void {
    this.grouped.unfold(group)
    this.active = group
    group.activity = false
    for (const g of this.groups) {
      const on = g === group
      g.el.hidden = !on
      g.button.setAttribute('aria-selected', String(on))
      this.decorate(g)
    }
    this.syncButtons()
    requestAnimationFrame(() => {
      this.fitAll()
      group.active.view.focus()
    })
  }

  private markActivePane(group: Group): void {
    for (const p of group.panes) p.el.classList.toggle('active', p === group.active && group.panes.length > 1)
    this.decorate(group)
  }

  /** A tab's label and dot: what runs (or the folder), how the last command ended, output not seen. */
  private decorate(group: Group): void {
    const pane = group.active
    if (!pane) return
    const last = pane.term.lastCommand
    const running = group.panes.some((p) => {
      const c = p.term.lastCommand
      return !!c && c.output !== undefined && c.end === undefined && !p.ended
    })
    const runningText = last && last.output !== undefined && last.end === undefined ? last.text : null
    const where = pane.cwd ? baseName(pane.cwd) : this.text.title
    group.label.textContent = group.task ? `${group.task} · ${where}` : runningText ? `${runningText.split(/\s+/)[0]} · ${where}` : where
    group.button.title = [pane.cwd, runningText ? this.text.running.replace('{command}', runningText) : ''].filter(Boolean).join('\n')
    // How the last finished command ended (the last one may be the empty prompt after it).
    const done = [...pane.term.commands].reverse().find((c) => c.end !== undefined)
    const failed = !!done && (done.exitCode ?? 0) !== 0
    const state = pane.ended ? 'ended' : running ? 'running' : group.activity ? 'activity' : failed ? 'fail' : ''
    group.button.dataset.state = state
    group.button.classList.toggle('ended', group.panes.every((p) => p.ended))
  }

  // Actions ---------------------------------------------------------------------------------

  /** A tab's menu: its colour and group; it, the others, those to its right or all closed. */
  private tabMenu(group: Group, x: number, y: number): void {
    const m = this.text.tabMenu
    const i = this.groups.indexOf(group)
    const others = this.groups.filter((g) => g !== group)
    const right = this.groups.slice(i + 1)
    const closeAll = (list: Group[]) => {
      for (const g of list) this.closeGroup(g)
    }
    popMenuAt(x, y, [
      ...this.grouped.tabItems(group, x, y),
      SEPARATOR,
      { label: this.text.close, testid: 'console-tab-close', action: () => this.closeGroup(group) },
      { label: m.closeOthers, testid: 'console-tab-close-others', disabled: others.length === 0, action: () => closeAll(others) },
      { label: m.closeRight, testid: 'console-tab-close-right', disabled: right.length === 0, action: () => closeAll(right) },
      { label: m.closeAll, testid: 'console-tab-close-all', action: () => closeAll([...this.groups]) },
    ])
  }

  private async openPath(pane: Pane, text: string): Promise<void> {
    const found = await this.bridge.resolve(pane.cwd, text)
    if (found) this.bridge.openFile(found.path, found.line)
  }

  private menu(pane: Pane, x: number, y: number): void {
    const group = this.active!
    const mac = this.bridge.platform === 'darwin'
    const mod = mac ? '⌘' : 'Ctrl+Shift+'
    const items: MenuItem[] = [
      { label: this.text.copy, icon: 'copy', keys: `${mod}C`, disabled: !pane.view.hasSelection(), action: () => void navigator.clipboard.writeText(pane.view.getSelection()) },
      { label: this.text.paste, icon: 'paste', keys: `${mod}V`, action: () => void navigator.clipboard.readText().then((t) => t && pane.term.paste(t)) },
      { label: this.text.selectAll, keys: `${mod}A`, action: () => pane.view.selectAll() },
      { label: this.text.find, icon: 'search', keys: mac ? '⌘F' : 'Ctrl+F', action: () => this.bridge.find() },
      { label: this.text.clear, keys: mac ? '⌘K' : 'Ctrl+Shift+K', action: () => pane.view.clear() },
      { separator: true, label: '', action: () => undefined },
      { label: this.text.split, icon: 'split', keys: mac ? '⌘D' : 'Ctrl+Shift+D', disabled: group.panes.length >= 2, action: () => void this.split() },
      { label: document.body.classList.contains('console-max') ? this.text.restore : this.text.maximize, icon: 'maximize', action: () => this.toggleMaximized() },
      { label: this.position === 'bottom' ? this.text.toRight : this.text.toBottom, icon: 'panelRight', action: () => this.setPosition(this.position === 'bottom' ? 'right' : 'bottom') },
      { separator: true, label: '', action: () => undefined },
      { label: group.panes.length > 1 ? this.text.closePane : this.text.close, icon: 'close', action: () => this.closePane(group, pane) },
    ]
    popMenuAt(x, y, items)
  }

  /** The console's own keys: clear, from command to command, split. */
  private onKey(e: KeyboardEvent): void {
    const pane = this.active?.active
    if (!pane) return
    const mac = this.bridge.platform === 'darwin'
    const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey
    if (!mod || e.altKey) return
    const key = e.key.toLowerCase()
    const act: Record<string, () => void> = {
      k: () => pane.view.clear(),
      arrowup: () => void pane.view.scrollToCommand(-1),
      arrowdown: () => void pane.view.scrollToCommand(1),
      d: () => void this.split(),
    }
    const fn = act[key]
    if (!fn) return
    e.preventDefault()
    e.stopPropagation()
    fn()
  }

  private toggleMaximized(): void {
    document.body.classList.toggle('console-max')
    this.syncButtons()
    requestAnimationFrame(() => this.fitAll())
  }

  private setPosition(position: Position): void {
    this.position = position
    this.save()
    this.place()
    this.syncButtons()
    requestAnimationFrame(() => this.fitAll())
  }

  /** Under the page, or beside it: the panel moved into place, sized as the user left it. */
  private place(): void {
    const right = this.position === 'right'
    const host = right ? document.querySelector('.content') : document.querySelector('.main')
    if (host && this.el.parentElement !== host) host.append(this.el)
    this.el.classList.toggle('right', right)
    this.el.style.height = right ? '' : `${this.size.bottom}px`
    this.el.style.width = right ? `${this.size.right}px` : ''
  }

  private drag(e: PointerEvent, grip: HTMLElement): void {
    e.preventDefault()
    grip.setPointerCapture(e.pointerId)
    const right = this.position === 'right'
    const start = right ? e.clientX : e.clientY
    const from = right ? this.el.offsetWidth : this.el.offsetHeight
    const move = (ev: PointerEvent): void => {
      const delta = start - (right ? ev.clientX : ev.clientY)
      const max = right ? window.innerWidth - 360 : window.innerHeight - 160
      this.size[this.position] = Math.max(right ? 280 : 100, Math.min(max, from + delta))
      this.place()
    }
    const up = (): void => {
      grip.removeEventListener('pointermove', move)
      this.save()
      this.fitAll()
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up, { once: true })
  }

  private save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify({ position: this.position, size: this.size }))
    } catch {
      /* kept for this window only */
    }
  }

  private fitAll(): void {
    if (this.el.hidden || !this.active) return
    for (const p of this.active.panes) p.view.fit()
  }

  private syncButtons(): void {
    const b = this.buttons
    const set = (el: HTMLButtonElement, label: string, name: IconName): void => {
      el.title = label
      el.setAttribute('aria-label', label)
      el.replaceChildren(icon(name))
    }
    set(b.position, this.position === 'bottom' ? this.text.toRight : this.text.toBottom, this.position === 'bottom' ? 'panelRight' : 'panelBottom')
    const max = document.body.classList.contains('console-max')
    set(b.maximize, max ? this.text.restore : this.text.maximize, max ? 'minimize' : 'maximize')
    b.maximize.setAttribute('aria-pressed', String(max))
    b.split.disabled = !this.active || this.active.panes.length >= 2
  }

  private applyTheme(): void {
    const t = this.dark ? DARK : LIGHT
    this.el.style.setProperty('--console-bg', t.background)
    this.el.style.setProperty('--console-fg', t.foreground)
    for (const g of this.groups) for (const p of g.panes) p.view.setTheme(t)
  }
}
