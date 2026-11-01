/**
 * The history panel (ADR-001, stage 4): the versions of the active file in
 * its folder's git history, the branch, starting a history, committing on
 * save, committing now with a message. Choosing a version opens it. Branches,
 * the remote and sync, and a merge left open by conflicts (stage 4b).
 */
import { renderCommitGraph } from '@dskripchenko/diagrams'
import { folio, prefs, type GitInfo, type GitRefusal, type Version } from './bridge'

export interface HistoryText {
  title: string
  noFile: string
  outside: string
  noHistory: string
  start: string
  autoCommit: string
  commitNow: string
  commitPlaceholder: string
  commit: string
  noVersions: string
  nothingToCommit: string
  close: string
  scopeFile: string
  scopeAll: string
  graph: string
  branches: string
  newBranch: string
  create: string
  switched: string
  remotePlaceholder: string
  connect: string
  sync: string
  syncing: string
  synced: Record<'up-to-date' | 'pushed' | 'pulled' | 'merged' | 'conflict', string>
  username: string
  token: string
  remember: string
  signIn: string
  mergeConflicts: string
  mergeReady: string
  finishMerge: string
  abortMerge: string
  mergeDone: string
  errors: Record<GitRefusal['error'] | 'authSystem', string>
}

/** The height of a version in the list: the graph's rows are drawn to it. */
const ROW = 44

/** Words for a git refusal: file names short, the rest as git gave it. */
export function describeRefusal(errors: HistoryText['errors'], r: GitRefusal): string {
  const files = r.detail.map((p) => p.split(/[\\/]/).pop()).join(', ')
  return (errors[r.error] ?? errors.network).replace('{files}', files).replace('{detail}', r.detail.join(' '))
}

interface Options {
  el: HTMLElement
  text: () => HistoryText
  locale: () => string
  open: (path: string, version: Version) => void
  /** Open a file (a conflicted one, from the merge). */
  openFile: (path: string) => void
  /** The version open in the document, to mark it. */
  current: () => string | null
}

export class HistoryPanel {
  private path: string | null = null
  private generation = 0
  /** The commit message being typed: kept when the panel is drawn again (a save, a commit elsewhere). */
  /**
   * The commit form lives across redraws (a save, a commit elsewhere): the
   * same element keeps what is being typed, and a redraw never swaps it out
   * from under the hand typing into it.
   */
  private form: HTMLFormElement | null = null

  /** While a merge is open, files resolved anywhere (here or in another editor) update its list. */
  private merging = false
  private fsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly o: Options) {
    folio().onFsChanged(() => {
      if (!this.merging || !this.visible) return
      if (this.fsTimer) clearTimeout(this.fsTimer)
      this.fsTimer = setTimeout(() => void this.refresh(), 200)
    })
  }

  get visible(): boolean {
    return !this.o.el.hidden
  }

  setVisible(on: boolean): void {
    this.o.el.hidden = !on
    if (on) void this.refresh()
  }

  /** Follow the active document. */
  show(path: string | null): void {
    this.path = path
    if (this.visible) void this.refresh()
  }

  async refresh(): Promise<void> {
    const gen = ++this.generation
    const t = this.o.text()
    const el = this.o.el
    const path = this.path
    const head = document.createElement('header')
    const title = document.createElement('span')
    title.textContent = t.title
    const closer = document.createElement('button')
    closer.type = 'button'
    closer.className = 'icon'
    closer.textContent = '×'
    closer.setAttribute('aria-label', t.close)
    closer.addEventListener('click', () => this.setVisible(false))
    head.append(title, closer)

    if (path === null) {
      el.replaceChildren(head, this.hint(t.noFile))
      return
    }
    const info = await folio().gitInfo(path)
    if (gen !== this.generation) return
    if (!info || info.root === null) {
      const parts: HTMLElement[] = [head, this.hint(info?.canStart ? t.noHistory : t.outside)]
      if (info?.canStart) {
        const actions = document.createElement('div')
        actions.className = 'actions'
        actions.append(this.button(t.start, 'start', async () => {
          await folio().gitStart(path)
          void this.refresh()
        }))
        parts.push(actions)
      }
      el.replaceChildren(...parts)
      return
    }
    this.merging = info.merging !== null
    const versions = await folio().gitHistory(path, this.scope)
    if (gen !== this.generation) return
    const focused = this.form?.contains(document.activeElement) ? document.activeElement : null
    el.replaceChildren(head, ...this.settings(path, info), this.scopes(), this.list(path, versions))
    if (focused instanceof HTMLElement) focused.focus()
  }

  private hint(text: string): HTMLElement {
    const p = document.createElement('p')
    p.className = 'hint'
    p.textContent = text
    return p
  }

  private button(label: string, id: string, click: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'action'
    b.dataset.action = id
    b.textContent = label
    b.addEventListener('click', click)
    return b
  }

  private settings(path: string, info: GitInfo): HTMLElement[] {
    const t = this.o.text()
    const out: HTMLElement[] = []
    if (info.branch) out.push(this.branchBlock(path, info))
    out.push(this.remoteBlock(path, info))
    if (this.note) {
      const p = document.createElement('p')
      p.className = `git-note ${this.note.kind}`
      p.dataset.testid = 'git-note'
      p.setAttribute('role', this.note.kind === 'error' ? 'alert' : 'status')
      p.textContent = this.note.text
      out.push(p)
    }
    if (this.loginFor === info.remote && info.remote) out.push(this.loginForm(path))
    if (info.merging) {
      out.push(this.mergeBlock(path, info.merging.conflicts))
      return out
    }
    const actions = document.createElement('div')
    actions.className = 'actions'
    if (info.canAutoCommit) {
      const label = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = info.autoCommit
      box.dataset.testid = 'auto-commit'
      box.addEventListener('change', () => void folio().gitAuto(path, box.checked))
      label.append(box, t.autoCommit)
      actions.append(label)
    }
    // Commit now, with a message of one's own.
    actions.append(this.commitForm())
    out.push(actions)
    return out
  }

  /** What a git action said, shown under the branch until the next action. */
  private note: { kind: 'ok' | 'error'; text: string } | null = null
  /** The remote whose login is asked for (the built-in transport). */
  private loginFor: string | null = null
  private branchesOpen = false

  private say(kind: 'ok' | 'error', text: string): void {
    this.note = text === '' ? null : { kind, text }
  }

  private refusal(r: GitRefusal): string {
    return describeRefusal(this.o.text().errors, r)
  }

  /** Run an action; a refusal becomes the note, then the panel is drawn again. */
  private async act<T extends object>(run: () => Promise<T | GitRefusal>, done?: (result: T) => void): Promise<void> {
    const result = await run()
    if ('error' in result) this.say('error', this.refusal(result as GitRefusal))
    else {
      this.note = null
      done?.(result as T)
    }
    await this.refresh()
  }

  private branchBlock(path: string, info: GitInfo): HTMLElement {
    const t = this.o.text()
    const box = document.createElement('div')
    box.className = 'branches'
    const current = document.createElement('button')
    current.type = 'button'
    current.className = 'branch'
    current.dataset.testid = 'branch'
    current.textContent = info.branch
    current.title = t.branches
    current.setAttribute('aria-expanded', String(this.branchesOpen))
    current.addEventListener('click', () => {
      this.branchesOpen = !this.branchesOpen
      void this.refresh()
    })
    box.append(current)
    if (!this.branchesOpen) return box

    const menu = document.createElement('div')
    menu.className = 'branch-menu'
    menu.dataset.testid = 'branch-menu'
    for (const name of info.branches) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = name
      b.classList.toggle('current', name === info.branch)
      b.disabled = name === info.branch || info.merging !== null
      b.addEventListener('click', () =>
        void this.act(() => folio().gitBranchSwitch(path, name), () => {
          this.branchesOpen = false
          this.say('ok', t.switched.replace('{branch}', name))
        }),
      )
      menu.append(b)
    }
    const form = document.createElement('form')
    form.className = 'inline-form'
    const input = document.createElement('input')
    input.placeholder = t.newBranch
    input.dataset.testid = 'new-branch'
    input.setAttribute('aria-label', t.newBranch)
    const go = document.createElement('button')
    go.type = 'submit'
    go.className = 'action'
    go.textContent = t.create
    form.append(input, go)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const name = input.value.trim()
      if (name === '') return
      void this.act(() => folio().gitBranchCreate(path, name), () => {
        this.branchesOpen = false
        this.say('ok', t.switched.replace('{branch}', name))
      })
    })
    menu.append(form)
    box.append(menu)
    return box
  }

  private remoteBlock(path: string, info: GitInfo): HTMLElement {
    const t = this.o.text()
    const box = document.createElement('div')
    box.className = 'remote'
    if (!info.remote) {
      const form = document.createElement('form')
      form.className = 'inline-form'
      const input = document.createElement('input')
      input.placeholder = t.remotePlaceholder
      input.dataset.testid = 'remote-url'
      input.setAttribute('aria-label', t.remotePlaceholder)
      const go = document.createElement('button')
      go.type = 'submit'
      go.className = 'action'
      go.textContent = t.connect
      form.append(input, go)
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        if (input.value.trim() !== '') void this.act(() => folio().gitRemote(path, input.value.trim()))
      })
      box.append(form)
      return box
    }
    const where = document.createElement('span')
    where.className = 'remote-url'
    where.textContent = info.remote.replace(/^https?:\/\//, '').replace(/\.git$/, '')
    where.title = info.remote
    const sync = document.createElement('button')
    sync.type = 'button'
    sync.className = 'action'
    sync.dataset.testid = 'sync'
    const counts = info.counts && (info.counts.ahead || info.counts.behind) ? ` ↑${info.counts.ahead} ↓${info.counts.behind}` : ''
    sync.textContent = t.sync + counts
    sync.disabled = info.merging !== null
    sync.addEventListener('click', () => void this.sync(path, sync))
    box.append(where, sync)
    return box
  }

  private async sync(path: string, button: HTMLButtonElement): Promise<void> {
    const t = this.o.text()
    button.disabled = true
    button.textContent = t.syncing
    const info = await folio().gitInfo(path)
    const result = await folio().gitSync(path)
    if ('error' in result && result.error === 'auth') {
      // The built-in transport asks for a login here; the system git has its own ways (a credential helper, SSH keys).
      const builtin = info?.transport === 'builtin'
      if (builtin && info?.remote) this.loginFor = info.remote
      this.say('error', (builtin ? t.errors.auth : t.errors.authSystem).replace('{detail}', result.detail.join(' ')))
      return this.refresh()
    }
    await this.act(async () => result, (r) => {
      this.loginFor = null
      this.say('ok', t.synced[r.result])
    })
  }

  private loginForm(path: string): HTMLElement {
    const t = this.o.text()
    const form = document.createElement('form')
    form.className = 'login'
    form.dataset.testid = 'login'
    const user = document.createElement('input')
    user.placeholder = t.username
    user.setAttribute('aria-label', t.username)
    user.autocomplete = 'username'
    const token = document.createElement('input')
    token.type = 'password'
    token.placeholder = t.token
    token.setAttribute('aria-label', t.token)
    token.autocomplete = 'current-password'
    const label = document.createElement('label')
    const remember = document.createElement('input')
    remember.type = 'checkbox'
    remember.checked = true
    label.append(remember, t.remember)
    const go = document.createElement('button')
    go.type = 'submit'
    go.className = 'action'
    go.textContent = t.signIn
    form.append(user, token, label, go)
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (token.value === '') return
      const saved = await folio().gitLogin(path, user.value || 'git', token.value, remember.checked)
      if ('error' in saved) {
        this.say('error', this.refusal(saved))
        return void this.refresh()
      }
      this.loginFor = null
      const sync = this.o.el.querySelector<HTMLButtonElement>('[data-testid="sync"]')
      if (sync) await this.sync(path, sync)
    })
    return form
  }

  private mergeBlock(path: string, conflicts: string[]): HTMLElement {
    const t = this.o.text()
    const box = document.createElement('div')
    box.className = 'merge'
    box.dataset.testid = 'merge'
    const p = document.createElement('p')
    p.textContent = conflicts.length ? t.mergeConflicts.replace('{n}', String(conflicts.length)) : t.mergeReady
    box.append(p)
    if (conflicts.length) {
      const ul = document.createElement('ul')
      for (const file of conflicts) {
        const li = document.createElement('li')
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = file.split(/[\\/]/).pop() ?? file
        b.title = file
        b.addEventListener('click', () => this.o.openFile(file))
        li.append(b)
        ul.append(li)
      }
      box.append(ul)
    }
    const actions = document.createElement('div')
    actions.className = 'actions row'
    actions.append(
      this.button(t.finishMerge, 'merge-finish', () => void this.act(() => folio().gitMergeFinish(path), () => this.say('ok', t.mergeDone))),
      this.button(t.abortMerge, 'merge-abort', () => void this.act(() => folio().gitMergeAbort(path))),
    )
    box.append(actions)
    return box
  }

  private commitForm(): HTMLFormElement {
    const t = this.o.text()
    if (this.form) {
      this.form.querySelector('input')!.placeholder = t.commitPlaceholder
      this.form.querySelector('button')!.textContent = t.commit
      return this.form
    }
    const form = document.createElement('form')
    form.className = 'commit-form'
    const input = document.createElement('input')
    input.placeholder = t.commitPlaceholder
    input.dataset.testid = 'commit-message'
    input.addEventListener('input', () => input.setCustomValidity(''))
    const go = document.createElement('button')
    go.type = 'submit'
    go.className = 'action'
    go.textContent = t.commit
    form.append(input, go)
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const path = this.path
      const message = input.value
      if (path === null || message.trim() === '') return
      const oid = await folio().gitCommit(path, message)
      if (oid === null) {
        // Nothing new since the last commit: say so, keep the message.
        input.setCustomValidity(this.o.text().nothingToCommit)
        input.reportValidity()
        return
      }
      input.value = ''
      void this.refresh()
    })
    this.form = form
    return form
  }

  /** The file's versions, or every commit of the repository; kept between starts. */
  private scope: 'file' | 'all' = prefs.get<'file' | 'all'>('historyScope', 'file')

  private scopes(): HTMLElement {
    const t = this.o.text()
    const box = document.createElement('div')
    box.className = 'scopes'
    box.setAttribute('role', 'tablist')
    for (const [scope, label] of [['file', t.scopeFile], ['all', t.scopeAll]] as const) {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(this.scope === scope))
      b.dataset.testid = `scope-${scope}`
      b.textContent = label
      b.addEventListener('click', () => {
        this.scope = scope
        prefs.set('historyScope', scope)
        void this.refresh()
      })
      box.append(b)
    }
    return box
  }

  private list(path: string, versions: Version[]): HTMLElement {
    const t = this.o.text()
    if (versions.length === 0) return this.hint(t.noVersions)
    // The graph beside the list, Fork-style: a column whose rows are the list's rows.
    const box = document.createElement('div')
    box.className = 'graph-list'
    const head = versions.find((v) => v.refs.some((r) => r === 'HEAD' || r.startsWith('HEAD -> ')))?.oid
    const graph = renderCommitGraph(versions.map((v) => ({ id: v.oid, parents: v.parents })), { rowHeight: ROW, head, id: 'folio-history-graph', title: t.graph })
    const column = document.createElement('div')
    column.className = 'graph'
    column.dataset.testid = 'graph'
    column.innerHTML = graph.svg
    box.style.setProperty('--graph-width', `${graph.width}px`)
    box.style.setProperty('--row', `${ROW}px`)
    const ul = document.createElement('ul')
    ul.className = 'versions'
    ul.dataset.testid = 'versions'
    box.append(column, ul)
    const when = new Intl.DateTimeFormat(this.o.locale(), { dateStyle: 'medium', timeStyle: 'short' })
    for (const v of versions) {
      const li = document.createElement('li')
      li.tabIndex = 0
      li.dataset.oid = v.oid
      li.classList.toggle('active', this.o.current() === v.oid)
      const message = document.createElement('span')
      message.className = 'message'
      for (const ref of v.refs) {
        const chip = document.createElement('span')
        chip.className = ref.startsWith('HEAD') ? 'ref head' : ref.startsWith('tag: ') ? 'ref tag' : 'ref'
        chip.textContent = ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')
        message.append(chip)
      }
      message.append(v.message.split('\n')[0] ?? '')
      const meta = document.createElement('span')
      meta.className = 'meta'
      meta.textContent = `${v.author} · ${when.format(new Date(v.time * 1000))} · ${v.oid.slice(0, 7)}`
      li.title = v.message
      li.append(message, meta)
      const open = () => {
        for (const other of ul.querySelectorAll('li')) other.classList.toggle('active', other === li)
        this.o.open(path, v)
      }
      li.addEventListener('click', open)
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open()
      })
      ul.append(li)
    }
    return box
  }
}
