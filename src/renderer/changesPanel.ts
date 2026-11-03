/**
 * The changes of the repository in view, as a code editor's source control
 * shows them (ADR-002, I1): a message and Commit, the staged files, the
 * changed ones beside them — each staged or unstaged with a click, its
 * changes thrown away (asked first), opened by its name.
 */
import { iconButton } from './icons'

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'untracked'

export interface ChangeEntry {
  path: string
  kind: ChangeKind
}

export interface ChangesView {
  root: string
  branch: string | null
  staged: ChangeEntry[]
  unstaged: ChangeEntry[]
}

export interface ChangesText {
  title: string
  close: string
  message: string
  commit: string
  staged: string
  changes: string
  stage: string
  unstage: string
  stageAll: string
  unstageAll: string
  discard: string
  none: string
  noRepo: string
  /** The message is empty, or nothing is staged. */
  nothing: string
  committed: string
}

export interface ChangesDeps {
  /** The changes of the repository holding a path; null outside git. */
  load(path: string | null): Promise<ChangesView | null>
  stage(root: string, paths: string[]): Promise<void>
  unstage(root: string, paths: string[]): Promise<void>
  /** Asks first; true when thrown away. */
  discard(root: string, path: string): Promise<boolean>
  commit(root: string, message: string): Promise<string | null>
  open(root: string, path: string): void
}

const LETTER: Record<ChangeKind, string> = { added: 'A', modified: 'M', deleted: 'D', untracked: 'U' }

export class ChangesPanel {
  readonly el: HTMLElement
  private readonly message: HTMLTextAreaElement
  private readonly commitButton: HTMLButtonElement
  private readonly status: HTMLElement
  private readonly list: HTMLElement
  private path: string | null = null
  private view: ChangesView | null = null
  private seq = 0

  constructor(
    private text: ChangesText,
    private readonly deps: ChangesDeps,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'changes-panel'
    this.el.dataset.testid = 'changes-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'changes-title'
    header.append(title, iconButton('close', text.close, () => this.setVisible(false)))
    this.message = document.createElement('textarea')
    this.message.className = 'changes-message'
    this.message.dataset.testid = 'changes-message'
    this.message.rows = 3
    this.message.spellcheck = true
    // Cmd/Ctrl+Enter commits, as in code editors.
    this.message.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void this.commit()
      }
    })
    this.commitButton = document.createElement('button')
    this.commitButton.type = 'button'
    this.commitButton.className = 'changes-commit'
    this.commitButton.dataset.testid = 'changes-commit'
    this.commitButton.addEventListener('click', () => void this.commit())
    this.status = document.createElement('div')
    this.status.className = 'changes-status'
    this.status.dataset.testid = 'changes-status'
    this.list = document.createElement('div')
    this.list.className = 'changes-list'
    this.el.append(header, this.message, this.commitButton, this.status, this.list)
    this.setText(text)
  }

  setText(text: ChangesText): void {
    this.text = text
    this.el.querySelector('.changes-title')!.textContent = text.title
    this.message.placeholder = text.message
    this.commitButton.textContent = text.commit
    void this.refresh()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    this.onVisibility(on)
    if (on) {
      void this.refresh()
      this.message.focus()
    }
  }

  /** The document (or folder) in view: its repository's changes. */
  show(path: string | null): void {
    if (path === this.path) return
    this.path = path
    void this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.el.hidden) return
    const seq = ++this.seq
    const view = await this.deps.load(this.path)
    if (seq !== this.seq) return
    this.view = view
    this.commitButton.disabled = !view || view.staged.length === 0
    if (!view) {
      this.list.replaceChildren(this.note(this.text.noRepo))
      return
    }
    if (view.staged.length === 0 && view.unstaged.length === 0) {
      this.list.replaceChildren(this.note(this.text.none))
      return
    }
    this.list.replaceChildren(
      ...(view.staged.length ? [this.section('staged', view.staged)] : []),
      ...(view.unstaged.length ? [this.section('unstaged', view.unstaged)] : []),
    )
  }

  private note(text: string): HTMLElement {
    const p = document.createElement('p')
    p.className = 'changes-none'
    p.textContent = text
    return p
  }

  private section(which: 'staged' | 'unstaged', entries: ChangeEntry[]): HTMLElement {
    const view = this.view!
    const section = document.createElement('section')
    section.className = `changes-group changes-${which}`
    section.dataset.testid = `changes-${which}`
    const h = document.createElement('h3')
    const label = document.createElement('span')
    label.textContent = `${which === 'staged' ? this.text.staged : this.text.changes} · ${entries.length}`
    const all =
      which === 'staged'
        ? iconButton('minus', this.text.unstageAll, () => void this.act(() => this.deps.unstage(view.root, entries.map((e) => e.path))))
        : iconButton('plus', this.text.stageAll, () => void this.act(() => this.deps.stage(view.root, entries.map((e) => e.path))))
    all.dataset.testid = `changes-${which}-all`
    h.append(label, all)
    section.append(h, ...entries.map((e) => this.row(which, e)))
    return section
  }

  private row(which: 'staged' | 'unstaged', entry: ChangeEntry): HTMLElement {
    const view = this.view!
    const row = document.createElement('div')
    row.className = `changes-row changes-${entry.kind}`
    row.dataset.testid = 'change'
    row.dataset.path = entry.path
    const name = document.createElement('button')
    name.type = 'button'
    name.className = 'changes-name'
    const parts = entry.path.split('/')
    const file = document.createElement('span')
    file.textContent = parts.pop()!
    const dir = document.createElement('span')
    dir.className = 'changes-dir'
    dir.textContent = parts.join('/')
    name.append(file, dir)
    name.title = entry.path
    name.addEventListener('click', () => {
      if (entry.kind !== 'deleted') this.deps.open(view.root, entry.path)
    })
    const actions = document.createElement('span')
    actions.className = 'changes-actions'
    if (which === 'unstaged') {
      const discard = iconButton('undo', this.text.discard, () => void this.act(() => this.deps.discard(view.root, entry.path)))
      discard.dataset.testid = 'change-discard'
      actions.append(discard)
    }
    const toggle =
      which === 'staged'
        ? iconButton('minus', this.text.unstage, () => void this.act(() => this.deps.unstage(view.root, [entry.path])))
        : iconButton('plus', this.text.stage, () => void this.act(() => this.deps.stage(view.root, [entry.path])))
    toggle.dataset.testid = which === 'staged' ? 'change-unstage' : 'change-stage'
    actions.append(toggle)
    const letter = document.createElement('span')
    letter.className = 'changes-kind'
    letter.textContent = LETTER[entry.kind]
    row.append(name, actions, letter)
    return row
  }

  private async act(fn: () => Promise<unknown>): Promise<void> {
    this.status.textContent = ''
    await fn()
    await this.refresh()
  }

  private async commit(): Promise<void> {
    const view = this.view
    const message = this.message.value.trim()
    if (!view || !message || view.staged.length === 0) {
      this.status.textContent = this.text.nothing
      return
    }
    const oid = await this.deps.commit(view.root, message)
    if (oid) {
      this.message.value = ''
      this.status.textContent = this.text.committed.replace('{oid}', oid.slice(0, 7))
    }
    await this.refresh()
  }
}
