/**
 * The settings window (ADR-004 D7): keys of one's own over `keybindings.json`
 * — every command of folio and of the code editor, its keys, a new one taken
 * from the keys pressed, clashes shown — and the project's own settings over
 * its `.folio/settings.json`, as a form.
 */
import type { AppSettings, ProjectSettingsData } from './bridge'
import { bytes } from './mediaView'

export interface SettingsText {
  title: string
  keys: string
  project: string
  languageTab: string
  languageSystem: string
  languageHint: string
  search: string
  set: string
  press: string
  remove: string
  resetAll: string
  clash: string
  editor: string
  noProject: string
  kind: string
  kindAuto: string
  kindNotes: string
  kindCode: string
  indent: string
  indentAuto: string
  spaces: string
  tab: string
  tabSize: string
  formatOnSave: string
  formatter: string
  formatterNone: string
  formatterOwn: string
  tasks: string
  taskName: string
  taskCommand: string
  add: string
  servers: string
  language: string
  serverCommand: string
  serverOff: string
  save: string
  saved: string
  close: string
  appTab: string
  logDays: string
  logHint: string
  softLimit: string
  softHint: string
  lspLimit: string
  lspHint: string
  heapLimit: string
  heapHint: string
  applied: string
  diskGb: string
  diskHint: string
  commandSec: string
  commandHint: string
  consoleGb: string
  consoleHint: string
  dataSize: string
  clearCaches: string
  cleared: string
}

export interface KeyedCommand {
  /** As keybindings.json names it: `folio.<id>` or the editor's command. */
  command: string
  title: string
  group: string
  /** Its own keys, as folio or the editor has them (for showing). */
  defaults: string[]
}

export interface SettingsDeps {
  text(): SettingsText
  mac: boolean
  commands(): KeyedCommand[]
  bindings(): Promise<{ key: string; command: string }[]>
  saveBindings(list: { key: string; command: string }[]): Promise<void>
  /** The keys of an event as the editor names them (`Meta-Shift-k`). */
  keyName(event: KeyboardEvent): string
  /** The project of the file in view, and its settings. */
  project(): Promise<{ name: string; path: string; settings: ProjectSettingsData } | null>
  saveProject(path: string, settings: ProjectSettingsData): Promise<boolean>
  /** The languages there are and the one chosen (null: the system's); another chosen. */
  languages(): { list: { code: string; name: string }[]; choice: string | null }
  chooseLanguage(code: string | null): Promise<void>
  /** The app's own settings (ADR-007): the log's days, the memory limits; saved. */
  app(): Promise<AppSettings>
  saveApp(o: { logDays: number; limits: AppSettings['limits']; alerts: AppSettings['alerts'] }): Promise<void>
  dataSize(): Promise<Record<'total' | 'chromium' | 'update' | 'crashes' | 'logs' | 'session' | 'review', number>>
  clearCaches(): Promise<boolean>
  lang(): string
  units(): readonly string[]
}

const KNOWN_FORMATTERS = ['prettier', 'pint', 'gofmt', 'ruff', 'rustfmt', 'black', 'lsp']

/** A key as the file keeps it: the platform's command key is `Mod`, so the file works on every system. */
export function portableKey(name: string, mac: boolean): string {
  return name
    .split('-')
    .map((p, i, all) => (i < all.length - 1 && p === (mac ? 'Meta' : 'Ctrl') ? 'Mod' : p))
    .join('-')
}

/** A key as people read it: ⌘⇧K on macOS, Ctrl+Shift+K elsewhere. */
export function prettyKey(key: string, mac: boolean): string {
  const parts = key.split(/-(?!$)/)
  const last = parts.pop()!
  const name = last.length === 1 ? last.toUpperCase() : last === ' ' ? 'Space' : last.replace(/^Arrow/, '')
  const mods = parts.map((p) => {
    const m = p === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : p
    if (!mac) return m === 'Meta' ? 'Win' : m
    return { Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }[m] ?? m
  })
  return mac ? `${mods.join('')}${name}` : [...mods, name].join('+')
}

/** The same key, whatever way it is written (`Mod-k` and `Meta-k` on a Mac). */
function sameKey(a: string, b: string, mac: boolean): boolean {
  const norm = (k: string) => {
    const parts = k.split(/-(?!$)/)
    const key = parts.pop()!.toLowerCase()
    const mods = new Set(parts.map((p) => (p === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : p === 'Cmd' ? 'Meta' : p === 'Control' ? 'Ctrl' : p)))
    return [...['Alt', 'Ctrl', 'Meta', 'Shift'].filter((m) => mods.has(m)), key].join('-')
  }
  return norm(a) === norm(b)
}

export class SettingsDialog {
  readonly el: HTMLElement
  private readonly box: HTMLElement
  private pane: 'keys' | 'project' | 'language' | 'app' = 'keys'
  private list: { key: string; command: string }[] = []
  private filter = ''
  private capturing: string | null = null
  private returnFocus: Element | null = null

  constructor(private readonly deps: SettingsDeps) {
    this.el = document.createElement('div')
    this.el.className = 'palette-backdrop settings-backdrop'
    this.el.dataset.testid = 'settings'
    this.el.hidden = true
    this.box = document.createElement('div')
    this.box.className = 'settings-dialog'
    this.box.setAttribute('role', 'dialog')
    this.el.append(this.box)
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close()
    })
    // A key pressed while one is being set: that key (Escape gives it up). Otherwise Escape closes.
    // On the window, before folio's own shortcuts (made first): a key just set must not run its command here.
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.el.hidden) return
        if (this.capturing) {
          if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
          e.preventDefault()
          e.stopImmediatePropagation()
          const command = this.capturing
          this.capturing = null
          if (e.key !== 'Escape') void this.bind(command, portableKey(this.deps.keyName(e), this.deps.mac))
          else this.draw()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopImmediatePropagation()
          this.close()
        }
      },
      true,
    )
  }

  async open(pane: 'keys' | 'project' | 'language' = 'keys'): Promise<void> {
    this.returnFocus = document.activeElement
    this.pane = pane
    this.list = await this.deps.bindings()
    this.el.hidden = false
    await this.draw()
  }

  close(): void {
    this.el.hidden = true
    this.capturing = null
    ;(this.returnFocus as HTMLElement | null)?.focus?.()
  }

  private async draw(): Promise<void> {
    const t = this.deps.text()
    const head = document.createElement('header')
    const title = document.createElement('strong')
    title.textContent = t.title
    const tabs = document.createElement('div')
    tabs.className = 'settings-tabs'
    for (const [pane, label] of [['keys', t.keys], ['project', t.project], ['language', t.languageTab], ['app', t.appTab]] as const) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.dataset.testid = `settings-${pane}`
      b.setAttribute('aria-pressed', String(this.pane === pane))
      b.addEventListener('click', () => {
        this.pane = pane
        void this.draw()
      })
      tabs.append(b)
    }
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'settings-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t.close)
    close.addEventListener('click', () => this.close())
    head.append(title, tabs, close)
    const body = this.pane === 'keys' ? this.keysPane() : this.pane === 'language' ? this.languagePane() : this.pane === 'app' ? await this.appPane() : await this.projectPane()
    this.box.replaceChildren(head, body)
  }

  // The app (ADR-007) ---------------------------------------------------------------------

  private async appPane(): Promise<HTMLElement> {
    const t = this.deps.text()
    const s = await this.deps.app()
    const pane = document.createElement('form')
    pane.className = 'settings-project'
    pane.dataset.testid = 'settings-app-form'
    const number = (name: string, label: string, hint: string, value: number, min: number, max: number, step: number | 'any') => {
      const row = document.createElement('label')
      row.className = 'settings-field'
      const span = document.createElement('span')
      span.textContent = label
      const input = Object.assign(document.createElement('input'), { type: 'number', name, min: String(min), max: String(max), step: String(step), value: String(value) })
      input.dataset.testid = `settings-${name}`
      row.append(span, input)
      const p = document.createElement('p')
      p.className = 'settings-hint'
      p.textContent = hint
      pane.append(row, p)
      return input
    }
    const logDays = number('logDays', t.logDays, t.logHint, s.logDays, 1, 30, 1)
    const soft = number('softGb', t.softLimit, t.softHint, s.limits.softGb, 0, 256, 'any')
    const lsp = number('lspGb', t.lspLimit, t.lspHint, s.limits.lspGb, 0, 64, 'any')
    const heap = number('heapGb', t.heapLimit, t.heapHint.replace('{now}', bytes(s.heapLimit, this.deps.lang(), this.deps.units())), s.limits.heapGb, 0, 64, 'any')
    const disk = number('diskGb', t.diskGb, t.diskHint, s.alerts.diskGb, 0, 1024, 'any')
    const command = number('commandSec', t.commandSec, t.commandHint, s.alerts.commandSec, 0, 86400, 1)
    const consoleGb = number('consoleGb', t.consoleGb, t.consoleHint, s.alerts.consoleGb, 0, 256, 'any')
    // What folio-data holds, and its caches let go (never the unsaved, the review's marks or the settings).
    const size = (n: number) => bytes(n, this.deps.lang(), this.deps.units())
    const data = document.createElement('p')
    data.className = 'settings-hint'
    data.dataset.testid = 'settings-data-size'
    const fill = () =>
      void this.deps.dataSize().then((z) => {
        data.textContent = t.dataSize
          .replace('{total}', size(z.total))
          .replace('{chromium}', size(z.chromium))
          .replace('{update}', size(z.update))
          .replace('{crashes}', size(z.crashes))
          .replace('{logs}', size(z.logs))
          .replace('{session}', size(z.session))
      })
    fill()
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'settings-add'
    clear.textContent = t.clearCaches
    clear.dataset.testid = 'settings-clear-caches'
    const status = document.createElement('p')
    status.className = 'settings-hint'
    status.setAttribute('role', 'status')
    status.dataset.testid = 'settings-app-status'
    const save = document.createElement('button')
    save.type = 'submit'
    save.className = 'settings-add'
    save.textContent = t.save
    save.dataset.testid = 'settings-app-save'
    clear.addEventListener('click', () =>
      void this.deps.clearCaches().then(() => {
        status.textContent = t.cleared
        fill()
      }),
    )
    pane.append(data, clear, document.createElement('br'), save, status)
    const n = (el: HTMLInputElement, fallback: number) => (Number.isFinite(el.valueAsNumber) ? el.valueAsNumber : fallback)
    pane.addEventListener('submit', (e) => {
      e.preventDefault()
      void this.deps
        .saveApp({
          logDays: n(logDays, s.logDays),
          limits: { softGb: n(soft, s.limits.softGb), lspGb: n(lsp, s.limits.lspGb), heapGb: n(heap, s.limits.heapGb) },
          alerts: { diskGb: n(disk, s.alerts.diskGb), commandSec: n(command, s.alerts.commandSec), consoleGb: n(consoleGb, s.alerts.consoleGb) },
        })
        .then(() => (status.textContent = t.applied))
    })
    return pane
  }

  // Language ---------------------------------------------------------------------------

  private languagePane(): HTMLElement {
    const t = this.deps.text()
    const { list, choice } = this.deps.languages()
    const pane = document.createElement('div')
    pane.className = 'settings-language'
    const options: [string | null, string][] = [[null, t.languageSystem], ...list.map((l): [string, string] => [l.code, l.name])]
    for (const [code, name] of options) {
      const row = document.createElement('label')
      row.className = 'settings-field settings-radio'
      const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'language', checked: choice === code })
      radio.dataset.testid = `settings-language-${code ?? 'system'}`
      radio.addEventListener('change', () => void this.deps.chooseLanguage(code).then(() => this.draw()))
      const span = document.createElement('span')
      span.textContent = name
      row.append(radio, span)
      pane.append(row)
    }
    const hint = document.createElement('p')
    hint.className = 'settings-hint'
    hint.textContent = t.languageHint
    pane.append(hint)
    return pane
  }

  // Keys -------------------------------------------------------------------------------

  private keysPane(): HTMLElement {
    const t = this.deps.text()
    const mac = this.deps.mac
    const pane = document.createElement('div')
    pane.className = 'settings-keys'
    const tools = document.createElement('div')
    tools.className = 'settings-tools'
    const search = document.createElement('input')
    search.type = 'search'
    search.placeholder = t.search
    search.value = this.filter
    search.dataset.testid = 'settings-search'
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.textContent = t.resetAll
    reset.dataset.testid = 'settings-reset'
    reset.disabled = this.list.length === 0
    reset.addEventListener('click', () => void this.save([]))
    tools.append(search, reset)
    const table = document.createElement('div')
    table.className = 'settings-table'
    const all = this.deps.commands()
    const rows = () => {
      const q = this.filter.trim().toLowerCase()
      table.replaceChildren(
        ...all
          .filter((c) => !q || `${c.title} ${c.command} ${c.group}`.toLowerCase().includes(q) || this.keysOf(c).some((k) => prettyKey(k, mac).toLowerCase().includes(q)))
          .map((c) => this.row(c, all)),
      )
    }
    search.addEventListener('input', () => {
      this.filter = search.value
      rows()
    })
    rows()
    pane.append(tools, table)
    requestAnimationFrame(() => search.focus())
    return pane
  }

  private keysOf(c: KeyedCommand): string[] {
    return this.list.filter((b) => b.command === c.command).map((b) => b.key)
  }

  private row(c: KeyedCommand, all: KeyedCommand[]): HTMLElement {
    const t = this.deps.text()
    const mac = this.deps.mac
    const row = document.createElement('div')
    row.className = 'settings-row'
    row.dataset.testid = 'settings-command'
    row.dataset.command = c.command
    const name = document.createElement('span')
    name.className = 'settings-name'
    name.textContent = c.title
    const group = document.createElement('span')
    group.className = 'settings-group'
    group.textContent = c.group
    name.append(group)
    const keys = document.createElement('span')
    keys.className = 'settings-keyset'
    for (const k of c.defaults) {
      const kbd = document.createElement('kbd')
      kbd.className = 'default'
      kbd.textContent = k
      keys.append(kbd)
    }
    for (const k of this.keysOf(c)) {
      const kbd = document.createElement('kbd')
      kbd.className = 'own'
      kbd.dataset.testid = 'settings-own-key'
      kbd.textContent = prettyKey(k, mac)
      const x = document.createElement('button')
      x.type = 'button'
      x.textContent = '×'
      x.title = t.remove
      x.dataset.testid = 'settings-unbind'
      x.addEventListener('click', () => void this.save(this.list.filter((b) => !(b.command === c.command && b.key === k))))
      kbd.append(x)
      keys.append(kbd)
      // The same key on another command: said, the last one set wins in the file's order.
      const others = this.list.filter((b) => b.command !== c.command && sameKey(b.key, k, mac)).map((b) => all.find((x) => x.command === b.command)?.title ?? b.command)
      if (others.length) {
        const clash = document.createElement('span')
        clash.className = 'settings-clash'
        clash.dataset.testid = 'settings-clash'
        clash.textContent = t.clash.replace('{commands}', others.join(', '))
        keys.append(clash)
      }
    }
    const set = document.createElement('button')
    set.type = 'button'
    set.className = 'settings-set'
    set.dataset.testid = 'settings-set'
    set.textContent = this.capturing === c.command ? t.press : t.set
    set.classList.toggle('capturing', this.capturing === c.command)
    set.addEventListener('click', () => {
      this.capturing = c.command
      set.textContent = t.press
      set.classList.add('capturing')
    })
    row.append(name, keys, set)
    return row
  }

  private async bind(command: string, key: string): Promise<void> {
    if (this.list.some((b) => b.command === command && b.key === key)) return this.draw()
    await this.save([...this.list, { key, command }])
  }

  private async save(list: { key: string; command: string }[]): Promise<void> {
    this.list = list
    await this.deps.saveBindings(list)
    await this.draw()
  }

  // The project ------------------------------------------------------------------------------

  private async projectPane(): Promise<HTMLElement> {
    const t = this.deps.text()
    const pane = document.createElement('form')
    pane.className = 'settings-project'
    pane.dataset.testid = 'settings-project-form'
    const project = await this.deps.project()
    if (!project) {
      const p = document.createElement('p')
      p.className = 'settings-hint'
      p.textContent = t.noProject
      pane.append(p)
      return pane
    }
    const s = project.settings
    const title = document.createElement('h3')
    title.textContent = project.name
    const path = document.createElement('div')
    path.className = 'settings-hint'
    path.textContent = `${project.path}/.folio/settings.json`
    pane.append(title, path)

    const field = (label: string, control: HTMLElement) => {
      const row = document.createElement('label')
      row.className = 'settings-field'
      const span = document.createElement('span')
      span.textContent = label
      row.append(span, control)
      pane.append(row)
      return control
    }
    const select = (name: string, options: [string, string][], value: string) => {
      const el = document.createElement('select')
      el.name = name
      el.dataset.testid = `settings-${name}`
      for (const [v, label] of options) el.append(new Option(label, v, false, v === value))
      return el
    }
    const kind = field(t.kind, select('kind', [['', t.kindAuto], ['notes', t.kindNotes], ['code', t.kindCode]], s.kind ?? '')) as HTMLSelectElement
    const indentValue = s.indentUnit === undefined ? '' : s.indentUnit === '\t' ? 'tab' : String(s.indentUnit.length)
    const indent = field(t.indent, select('indent', [['', t.indentAuto], ['2', `2 ${t.spaces}`], ['4', `4 ${t.spaces}`], ['8', `8 ${t.spaces}`], ['tab', t.tab]], indentValue)) as HTMLSelectElement
    const tabSize = field(t.tabSize, Object.assign(document.createElement('input'), { type: 'number', min: '1', max: '16', name: 'tabSize', value: s.tabSize ? String(s.tabSize) : '' })) as HTMLInputElement
    tabSize.dataset.testid = 'settings-tabSize'
    tabSize.placeholder = t.indentAuto
    const formatOnSave = Object.assign(document.createElement('input'), { type: 'checkbox', name: 'formatOnSave', checked: !!s.formatOnSave })
    formatOnSave.dataset.testid = 'settings-formatOnSave'
    field(t.formatOnSave, formatOnSave)
    const known = s.formatter && KNOWN_FORMATTERS.includes(s.formatter) ? s.formatter : s.formatter ? 'own' : ''
    const formatter = field(t.formatter, select('formatter', [['', t.formatterNone], ...KNOWN_FORMATTERS.map((f): [string, string] => [f, f]), ['own', t.formatterOwn]], known)) as HTMLSelectElement
    const own = Object.assign(document.createElement('input'), { type: 'text', name: 'formatterCommand', value: known === 'own' ? (s.formatter ?? '') : '', placeholder: 'node fmt.js' })
    own.dataset.testid = 'settings-formatterCommand'
    // A row of its own under the formatter, shown for a command of the project's own.
    const ownRow = field('', own).parentElement!
    ownRow.hidden = known !== 'own'
    formatter.addEventListener('change', () => (ownRow.hidden = formatter.value !== 'own'))

    // Tasks and language servers: rows added and taken away.
    const listOf = <T>(label: string, items: T[], cols: [string, (item: T) => string][], blank: () => T, testid: string) => {
      const box = document.createElement('fieldset')
      box.className = 'settings-list'
      box.dataset.testid = testid
      const legend = document.createElement('legend')
      legend.textContent = label
      box.append(legend)
      const add = (item: T) => {
        const row = document.createElement('div')
        row.className = 'settings-list-row'
        for (const [placeholder, get] of cols) {
          const input = Object.assign(document.createElement('input'), { type: 'text', placeholder, value: get(item) })
          row.append(input)
        }
        const x = document.createElement('button')
        x.type = 'button'
        x.textContent = '×'
        x.title = t.remove
        x.addEventListener('click', () => row.remove())
        row.append(x)
        plus.before(row)
      }
      const plus = document.createElement('button')
      plus.type = 'button'
      plus.className = 'settings-add'
      plus.textContent = t.add
      plus.dataset.testid = `${testid}-add`
      plus.addEventListener('click', () => add(blank()))
      box.append(plus)
      items.forEach(add)
      pane.append(box)
      return () => [...box.querySelectorAll('.settings-list-row')].map((r) => [...r.querySelectorAll('input')].map((i) => i.value.trim()))
    }
    const tasks = listOf(t.tasks, s.tasks ?? [], [[t.taskName, (x) => x.name], [t.taskCommand, (x) => x.command]], () => ({ name: '', command: '' }), 'settings-tasks')
    const servers = listOf(
      t.servers,
      Object.entries(s.lsp ?? {}),
      [[t.language, (x) => x[0]], [t.serverCommand, (x) => (x[1] === false ? 'off' : x[1].join(' '))]],
      () => ['', []] as [string, string[] | false],
      'settings-servers',
    )
    const hint = document.createElement('p')
    hint.className = 'settings-hint'
    hint.textContent = t.serverOff
    pane.append(hint)

    const actions = document.createElement('div')
    actions.className = 'settings-actions'
    const save = document.createElement('button')
    save.type = 'submit'
    save.className = 'action'
    save.textContent = t.save
    save.dataset.testid = 'settings-save'
    const said = document.createElement('span')
    said.className = 'settings-said'
    said.dataset.testid = 'settings-said'
    actions.append(save, said)
    pane.append(actions)
    pane.addEventListener('submit', (e) => {
      e.preventDefault()
      const lsp: Record<string, string[] | false> = {}
      for (const [language, command] of servers()) if (language && command) lsp[language] = command === 'off' ? false : command.split(/\s+/)
      const next: ProjectSettingsData = {
        ...(kind.value ? { kind: kind.value as 'notes' | 'code' } : {}),
        ...(indent.value ? { indentUnit: indent.value === 'tab' ? '\t' : ' '.repeat(Number(indent.value)) } : {}),
        ...(tabSize.value ? { tabSize: Number(tabSize.value) } : {}),
        ...(formatOnSave.checked ? { formatOnSave: true } : {}),
        ...(formatter.value ? { formatter: formatter.value === 'own' ? own.value.trim() : formatter.value } : {}),
        tasks: tasks()
          .filter(([name, command]) => name && command)
          .map(([name, command]) => ({ name: name!, command: command! })),
        lsp,
      }
      void this.deps.saveProject(project.path, next).then((ok) => (said.textContent = ok ? t.saved : ''))
    })
    return pane
  }
}
