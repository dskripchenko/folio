/**
 * Consoles under the page: a panel of tabs, each a shell in the folder it
 * was opened for (Shared when none is named), drawn by `@dskripchenko/terminal`.
 * The panel's height is the user's; it follows the window's theme.
 */
import { DARK_THEME, LIGHT_THEME, Terminal, TerminalView } from '@dskripchenko/terminal'
import { icon, iconButton } from './icons'

export interface ConsoleText {
  title: string
  newConsole: string
  close: string
  hide: string
  ended: string
  failed: string
}

export interface ConsoleBridge {
  open(cwd: string | null, cols: number, rows: number): Promise<{ id: number; cwd: string } | { error: string }>
  input(id: number, data: string): void
  resize(id: number, cols: number, rows: number): void
  close(id: number): void
  onData(callback: (id: number, data: string) => void): void
  onExit(callback: (id: number, code: number) => void): void
  /** Open a web address in the system's browser. */
  external(url: string): void
}

interface Tab {
  id: number | null
  term: Terminal
  view: TerminalView
  pane: HTMLElement
  button: HTMLButtonElement
  label: HTMLElement
  cwd: string
  ended: boolean
}

const HEIGHT_KEY = 'folio.consoleHeight'

const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

export class ConsolePanel {
  readonly el: HTMLElement
  private readonly tabsEl: HTMLElement
  private readonly body: HTMLElement
  private readonly tabs: Tab[] = []
  private active: Tab | null = null
  private dark = false

  constructor(
    private text: ConsoleText,
    private readonly bridge: ConsoleBridge,
    private readonly onVisibility: () => void,
  ) {
    this.el = document.createElement('section')
    this.el.className = 'console-panel'
    this.el.dataset.testid = 'console-panel'
    this.el.hidden = true
    const grip = document.createElement('div')
    grip.className = 'console-grip'
    grip.setAttribute('role', 'separator')
    grip.setAttribute('aria-orientation', 'horizontal')
    const head = document.createElement('header')
    this.tabsEl = document.createElement('div')
    this.tabsEl.className = 'console-tabs'
    this.tabsEl.setAttribute('role', 'tablist')
    const add = iconButton('plus', text.newConsole, () => void this.open(this.active?.cwd ?? null))
    add.dataset.testid = 'console-new'
    const hide = iconButton('down', text.hide, () => this.setVisible(false))
    hide.dataset.testid = 'console-hide'
    head.append(this.tabsEl, add, hide)
    this.body = document.createElement('div')
    this.body.className = 'console-body'
    this.el.append(grip, head, this.body)
    try {
      const h = Number(localStorage.getItem(HEIGHT_KEY))
      if (h > 80) this.el.style.height = `${h}px`
    } catch {
      /* the default height */
    }

    // Dragging the top edge: the panel's height.
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      grip.setPointerCapture(e.pointerId)
      const startY = e.clientY
      const startH = this.el.offsetHeight
      const move = (ev: PointerEvent): void => {
        const h = Math.max(100, Math.min(window.innerHeight - 160, startH + startY - ev.clientY))
        this.el.style.height = `${h}px`
      }
      const up = (): void => {
        grip.removeEventListener('pointermove', move)
        try {
          localStorage.setItem(HEIGHT_KEY, String(this.el.offsetHeight))
        } catch {
          /* kept for this window only */
        }
      }
      grip.addEventListener('pointermove', move)
      grip.addEventListener('pointerup', up, { once: true })
    })

    bridge.onData((id, data) => this.tabs.find((t) => t.id === id)?.term.write(data))
    bridge.onExit((id, code) => {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return
      tab.ended = true
      tab.button.classList.add('ended')
      tab.term.write(`\r\n\x1b[2m${this.text.ended.replace('{code}', String(code))}\x1b[0m\r\n`)
    })
  }

  setText(text: ConsoleText): void {
    this.text = text
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  get count(): number {
    return this.tabs.length
  }

  setVisible(visible: boolean): void {
    if (this.el.hidden === !visible) return
    this.el.hidden = !visible
    if (visible && this.active) {
      this.active.view.fit()
      this.active.view.focus()
    }
    this.onVisibility()
  }

  /** Ctrl+`: a console if there is none, else the panel shown or hidden. */
  toggle(cwd: string | null): void {
    if (this.tabs.length === 0) void this.open(cwd)
    else this.setVisible(!this.visible)
  }

  setDark(dark: boolean): void {
    this.dark = dark
    for (const t of this.tabs) t.view.setTheme(dark ? DARK_THEME : LIGHT_THEME)
  }

  /** A new console in a folder (null: Shared). */
  async open(cwd: string | null): Promise<void> {
    this.setVisible(true)
    const pane = document.createElement('div')
    pane.className = 'console-term'
    pane.dataset.testid = 'console'
    this.body.append(pane)
    const term = new Terminal({ scrollback: 5000, foreground: (this.dark ? DARK_THEME : LIGHT_THEME).foreground, background: (this.dark ? DARK_THEME : LIGHT_THEME).background })
    const tab: Tab = { id: null, term, view: null as unknown as TerminalView, pane, button: document.createElement('button'), label: document.createElement('span'), cwd: cwd ?? '', ended: false }
    tab.view = new TerminalView(term, pane, {
      theme: this.dark ? DARK_THEME : LIGHT_THEME,
      onResize: (cols, rows) => tab.id !== null && this.bridge.resize(tab.id, cols, rows),
      onLink: (url) => {
        if (/^(https?:|mailto:)/i.test(url)) this.bridge.external(url)
      },
    })
    term.onData((data) => tab.id !== null && !tab.ended && this.bridge.input(tab.id, data))
    term.onTitle((title) => (tab.label.textContent = title || baseName(tab.cwd)))
    term.onCwd((dir) => {
      tab.cwd = dir
      if (!term.title) tab.label.textContent = baseName(dir)
    })
    const b = tab.button
    b.type = 'button'
    b.className = 'console-tab'
    b.setAttribute('role', 'tab')
    b.dataset.testid = 'console-tab'
    tab.label.className = 'console-tab-label'
    const close = document.createElement('span')
    close.className = 'console-tab-close'
    close.setAttribute('role', 'button')
    close.title = this.text.close
    close.append(icon('close', 12))
    b.append(icon('source', 13), tab.label, close)
    b.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.console-tab-close')) this.close(tab)
      else this.activate(tab)
    })
    b.addEventListener('auxclick', (e) => {
      if (e.button === 1) this.close(tab)
    })
    this.tabsEl.append(b)
    this.tabs.push(tab)
    this.activate(tab)
    const { cols, rows } = tab.view.fit()
    const opened = await this.bridge.open(cwd, cols, rows)
    if ('error' in opened) {
      tab.ended = true
      b.classList.add('ended')
      tab.label.textContent = this.text.title
      term.write(`\x1b[31m${this.text.failed.replace('{error}', opened.error)}\x1b[0m\r\n`)
      return
    }
    tab.id = opened.id
    tab.cwd = opened.cwd
    tab.label.textContent = baseName(opened.cwd)
    b.title = opened.cwd
    // The size may have changed while the shell started.
    this.bridge.resize(opened.id, term.cols, term.rows)
  }

  private activate(tab: Tab): void {
    this.active = tab
    for (const t of this.tabs) {
      const on = t === tab
      t.pane.hidden = !on
      t.button.setAttribute('aria-selected', String(on))
    }
    requestAnimationFrame(() => {
      tab.view.fit()
      tab.view.focus()
    })
  }

  private close(tab: Tab): void {
    if (tab.id !== null) this.bridge.close(tab.id)
    tab.view.dispose()
    tab.pane.remove()
    tab.button.remove()
    const i = this.tabs.indexOf(tab)
    this.tabs.splice(i, 1)
    if (this.active === tab) {
      const next = this.tabs[Math.min(i, this.tabs.length - 1)] ?? null
      if (next) this.activate(next)
      else {
        this.active = null
        this.setVisible(false)
      }
    }
  }
}
