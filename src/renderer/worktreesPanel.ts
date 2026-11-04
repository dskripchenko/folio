/**
 * The repository's worktrees beside the page (ADR-006, R4): the main copy and
 * each worktree (an agent's, a subagent's) — its branch, how far ahead of the
 * base and behind it, its changes not committed, when it last changed. Its
 * work reviewed against the base, opened as a project or in a terminal,
 * merged, taken into the main copy without a commit, or removed.
 */
import type enLocale from '../locales/en.json'
import type { ChangeSpec, Worktree } from '../common/review'
import { plural } from '../common/plural'
import type { GitRefusal } from './bridge'
import { iconButton } from './icons'
import { popMenuAt } from './menu'

export type WorktreesText = typeof enLocale.window.worktrees

export interface WorktreesDeps {
  load: (path: string, base: string | null) => Promise<{ ok: true; base: string; main: string; list: Worktree[] } | GitRefusal>
  branches: (path: string) => Promise<string[]>
  review: (spec: ChangeSpec) => void
  project: (main: string, path: string) => Promise<GitRefusal | null>
  console: (path: string) => void
  merge: (main: string, branch: string) => Promise<GitRefusal | null>
  take: (main: string, path: string, base: string) => Promise<GitRefusal | null>
  remove: (main: string, w: Worktree) => Promise<GitRefusal | null>
  /** git's refusals in words. */
  errors: () => Record<string, string>
  lang: () => string
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export class WorktreesPanel {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private readonly message: HTMLElement
  private readonly baseSelect: HTMLSelectElement
  private path: string | null = null
  private base: string | null = null
  private seq = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private drawn = ''

  constructor(
    private text: WorktreesText,
    private readonly deps: WorktreesDeps,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'worktrees-panel'
    this.el.dataset.testid = 'worktrees-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'worktrees-title'
    header.append(title, iconButton('close', text.close, () => this.setVisible(false)))
    const baseRow = document.createElement('label')
    baseRow.className = 'worktrees-base'
    const baseLabel = document.createElement('span')
    this.baseSelect = document.createElement('select')
    this.baseSelect.dataset.testid = 'worktrees-base'
    this.baseSelect.addEventListener('change', () => {
      this.base = this.baseSelect.value
      void this.refresh()
    })
    baseRow.append(baseLabel, this.baseSelect)
    this.message = document.createElement('p')
    this.message.className = 'worktrees-message'
    this.message.hidden = true
    this.list = document.createElement('ul')
    this.list.className = 'worktrees-list'
    this.el.append(header, baseRow, this.message, this.list)
    this.setText(text)
  }

  setText(text: WorktreesText): void {
    this.text = text
    this.el.querySelector('.worktrees-title')!.textContent = text.title
    this.el.querySelector('.worktrees-base span')!.textContent = text.base
    this.drawn = ''
    void this.refresh()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    this.onVisibility(on)
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (on) {
      void this.refresh()
      // Agents work in folders folio may not watch: looked at again now and then.
      this.timer = setInterval(() => void this.refresh(), 5000)
    }
  }

  /** A folder of the repository in view (the active file's, a review's). */
  show(path: string | null): void {
    if (path === this.path) return
    this.path = path
    this.base = null
    void this.refresh()
  }

  private say(text: string): void {
    this.message.textContent = text
    this.message.hidden = text === ''
  }

  private failure(r: GitRefusal | null): boolean {
    if (!r) return false
    this.say(r.error === 'no-git' ? this.text.noGit : (this.deps.errors()[r.error] ?? r.detail.join('\n')))
    return true
  }

  async refresh(): Promise<void> {
    if (this.el.hidden) return
    const seq = ++this.seq
    if (!this.path) {
      this.list.replaceChildren()
      this.say(this.text.noRepo)
      return
    }
    const r = await this.deps.load(this.path, this.base)
    if (seq !== this.seq) return
    if (!('ok' in r)) {
      this.list.replaceChildren()
      this.failure(r)
      return
    }
    this.say('')
    this.base = r.base
    const key = JSON.stringify(r) + this.deps.lang()
    if (key === this.drawn) return
    this.drawn = key
    void this.fillBases(r.main, r.base)
    this.list.replaceChildren(...r.list.map((w) => this.item(r.main, r.base, w)))
    if (r.list.length <= 1) {
      const hint = document.createElement('li')
      hint.className = 'worktrees-hint'
      hint.textContent = this.text.none
      this.list.append(hint)
    }
  }

  private async fillBases(main: string, base: string): Promise<void> {
    const branches = await this.deps.branches(main)
    const all = branches.includes(base) ? branches : [base, ...branches]
    if (JSON.stringify([...this.baseSelect.options].map((o) => o.value)) !== JSON.stringify(all)) {
      this.baseSelect.replaceChildren(...all.map((b) => new Option(b, b)))
    }
    this.baseSelect.value = base
  }

  private ago(ms: number): string {
    if (!ms) return ''
    const s = Math.round((ms - Date.now()) / 1000)
    const rtf = new Intl.RelativeTimeFormat(this.deps.lang(), { numeric: 'auto', style: 'short' })
    if (s > -60) return rtf.format(s, 'second')
    if (s > -3600) return rtf.format(Math.round(s / 60), 'minute')
    if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour')
    return rtf.format(Math.round(s / 86400), 'day')
  }

  private item(main: string, base: string, w: Worktree): HTMLElement {
    const t = this.text
    const li = document.createElement('li')
    li.className = 'worktree'
    li.dataset.testid = 'worktree'
    li.dataset.path = w.path
    li.toggleAttribute('data-main', w.main)
    const top = document.createElement('div')
    top.className = 'worktree-top'
    const name = document.createElement('span')
    name.className = 'worktree-name'
    name.textContent = w.main ? t.main : baseName(w.path)
    name.title = w.path
    const branch = document.createElement('span')
    branch.className = 'worktree-branch'
    branch.textContent = w.branch ?? t.detached
    top.append(name, branch)
    const meta = document.createElement('div')
    meta.className = 'worktree-meta'
    meta.dataset.testid = 'worktree-meta'
    const parts: string[] = []
    if (!w.main) parts.push(`↑${w.ahead} ↓${w.behind}`)
    parts.push(w.changed ? plural(w.changed, t.changed, this.deps.lang()) : t.clean)
    if (w.lastActivity) parts.push(this.ago(w.lastActivity))
    meta.textContent = parts.join(' · ')
    const acts = document.createElement('div')
    acts.className = 'worktree-actions'
    const btn = (label: string, testid: string, fn: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'rv-button'
      b.textContent = label
      b.dataset.testid = testid
      b.addEventListener('click', fn)
      return b
    }
    if (w.main) acts.append(btn(t.reviewWorking, 'worktree-review', () => this.deps.review({ kind: 'working', repo: w.path })))
    else {
      acts.append(btn(t.review, 'worktree-review', () => this.deps.review({ kind: 'worktree', path: w.path, base })))
      const more = btn('⋯', 'worktree-more', () => {
        const r = more.getBoundingClientRect()
        popMenuAt(r.left, r.bottom + 4, [
          { label: t.openProject, testid: 'worktree-project', action: () => void this.deps.project(main, w.path).then((e) => this.failure(e)) },
          { label: t.terminal, testid: 'worktree-terminal', action: () => this.deps.console(w.path) },
          { separator: true, label: '', action: () => undefined },
          { label: t.take, testid: 'worktree-take', action: () => void this.deps.take(main, w.path, base).then((e) => this.failure(e) || this.say(t.taken)) },
          { label: t.merge, testid: 'worktree-merge', disabled: !w.branch || w.ahead === 0, action: () => void this.deps.merge(main, w.branch!).then((e) => this.failure(e) || this.say(t.merged)) },
          { separator: true, label: '', action: () => undefined },
          { label: t.remove, testid: 'worktree-remove', action: () => void this.deps.remove(main, w).then((e) => this.failure(e) || void this.refresh()) },
        ])
      })
      acts.append(more)
    }
    li.append(top, meta, acts)
    return li
  }
}
