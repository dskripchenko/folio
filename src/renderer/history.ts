/**
 * The history panel (ADR-001, stage 4): the versions of the active file in
 * its folder's git history, the branch, starting a history, committing on
 * save, committing now with a message. Choosing a version opens it.
 */
import { folio, type GitInfo, type Version } from './bridge'

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
}

interface Options {
  el: HTMLElement
  text: () => HistoryText
  locale: () => string
  open: (path: string, version: Version) => void
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

  constructor(private readonly o: Options) {}

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
    const versions = await folio().gitHistory(path)
    if (gen !== this.generation) return
    const focused = this.form?.contains(document.activeElement) ? document.activeElement : null
    el.replaceChildren(head, ...this.settings(path, info), this.list(path, versions))
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
    if (info.branch) {
      const b = document.createElement('div')
      b.className = 'branch'
      b.dataset.testid = 'branch'
      b.textContent = info.branch
      out.push(b)
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

  private list(path: string, versions: Version[]): HTMLElement {
    const t = this.o.text()
    if (versions.length === 0) return this.hint(t.noVersions)
    const ul = document.createElement('ul')
    ul.className = 'versions'
    ul.dataset.testid = 'versions'
    const when = new Intl.DateTimeFormat(this.o.locale(), { dateStyle: 'medium', timeStyle: 'short' })
    for (const v of versions) {
      const li = document.createElement('li')
      li.tabIndex = 0
      li.dataset.oid = v.oid
      li.classList.toggle('active', this.o.current() === v.oid)
      const message = document.createElement('span')
      message.className = 'message'
      message.textContent = v.message.split('\n')[0] ?? ''
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
    return ul
  }
}
