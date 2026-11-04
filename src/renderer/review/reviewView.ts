import { escapeHtml, highlightLines, languageOf } from '@dskripchenko/syntax'
import type enLocale from '../../locales/en.json'
import { hunkState, type Hunk } from '../../common/hunks'
import { plural } from '../../common/plural'
import { editable, rootOf, type AgentEdit, type ChangedFile, type Changeset, type ChangeSpec, type FileTexts, type ReviewComment } from '../../common/review'
import { folio, prefs, type GitRefusal } from '../bridge'
import type { McpAnswer } from '../../common/mcp'
import { syntaxTheme } from '../code'
import { anchorOf, compose, contextOf, excerptOf } from './comments'
import { blocksOf, fileDiff, markRanges, type FileDiff, type Row } from './rows'

/**
 * A set of changes in a tab (ADR-006, R2), as a pull request's files: the
 * files on the left, marked as viewed; on the right each file's changes with
 * a little context, in one column or two, in the colours of its language,
 * the words changed within a line marked. The working copy's runs are staged,
 * taken out of the index or thrown away from here; a double click opens the
 * file to edit beside.
 */

export type ReviewText = typeof enLocale.window.review

export interface ReviewDeps {
  text: () => ReviewText
  /** git's refusals in words. */
  errors: () => Record<string, string>
  lang: () => string
  /** A file of the set opened (to edit, beside the review), at a line (1-based). */
  open: (path: string, line: number | null, edit: boolean) => void
  /** The tab's title changed. */
  titled: () => void
  /** Another set in a tab of its own (the working copy → since the last look). */
  openSet: (spec: ChangeSpec) => void
  /** The consoles to send comments to, text pasted into one, a console opened in a folder (R5). */
  consoles: () => { id: number; label: string; cwd: string; running: string | null }[]
  paste: (id: number, text: string) => 'ok' | 'gone' | 'unsafe'
  openConsole: (cwd: string) => void
}

interface FileView {
  file: ChangedFile
  section: HTMLElement
  head: HTMLElement
  body: HTMLElement
  nav: HTMLElement
  texts: FileTexts | null
  diff: FileDiff | null
  /** Of the texts shown: what a "viewed" mark is for. */
  hash: string | null
  /** Folded gaps opened by a click (the row they start at). */
  opened: Set<number>
  loading: boolean
  loaded: boolean
  folded: boolean
  viewed: boolean
}

type Layout = 'unified' | 'split'

/** A short hash of texts (FNV-1a and the length): enough to tell they changed. */
function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}:${text.length}`
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

function button(label: string, testid: string, onClick: () => void, cls = 'rv-button'): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.textContent = label
  b.dataset.testid = testid
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}

export class ReviewView {
  readonly el: HTMLElement
  private set: Changeset | null = null
  private readonly files = new Map<string, FileView>()
  private viewed: Record<string, string> = {}
  private comments: ReviewComment[] = []
  /** The last edit an agent reported of each file (R6), by its path. */
  private agentEdits = new Map<string, AgentEdit>()
  private sendButton: HTMLButtonElement | null = null
  /** An agent waiting for the person's answer on this set (R7). */
  private ask: { id: number; done: (a: McpAnswer) => void; bar: HTMLElement } | null = null
  private layout: Layout = prefs.get<Layout>('reviewLayout', 'unified')
  private readonly head: HTMLElement
  private readonly titleEl: HTMLElement
  private readonly summary: HTMLElement
  private readonly navList: HTMLElement
  private readonly list: HTMLElement
  private readonly message: HTMLElement
  private readonly observer: IntersectionObserver
  private loadingSet: Promise<void> | null = null
  private again = false

  constructor(
    readonly spec: ChangeSpec,
    private readonly deps: ReviewDeps,
  ) {
    syntaxTheme()
    this.el = document.createElement('div')
    this.el.className = 'review'
    this.el.dataset.testid = 'review'
    this.el.dataset.layout = this.layout
    this.head = document.createElement('header')
    this.head.className = 'rv-head'
    this.titleEl = document.createElement('span')
    this.titleEl.className = 'rv-title'
    this.summary = document.createElement('span')
    this.summary.className = 'rv-summary'
    this.summary.dataset.testid = 'review-summary'
    this.head.append(this.titleEl, this.summary)
    const body = document.createElement('div')
    body.className = 'rv-body'
    const nav = document.createElement('nav')
    nav.className = 'rv-nav'
    this.navList = document.createElement('ul')
    nav.append(this.navList)
    this.list = document.createElement('div')
    this.list.className = 'rv-files'
    this.message = document.createElement('p')
    this.message.className = 'rv-message'
    this.message.dataset.testid = 'review-message'
    this.message.hidden = true
    this.list.append(this.message)
    body.append(nav, this.list)
    this.el.append(this.head, body)
    this.buildTools()
    // A file's texts are read when it comes near the view.
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const fv = [...this.files.values()].find((f) => f.section === e.target)
          if (fv && !fv.loaded) void this.loadTexts(fv)
        }
      },
      { rootMargin: '600px 0px' },
    )
  }

  private get t(): ReviewText {
    return this.deps.text()
  }

  private buildTools(): void {
    const tools = document.createElement('span')
    tools.className = 'rv-tools'
    const layoutBtn = (l: Layout, label: string) => {
      const b = button(label, `review-${l}`, () => {
        this.layout = l
        prefs.set('reviewLayout', l)
        this.el.dataset.layout = l
        tools.querySelectorAll('[data-layout-choice]').forEach((x) => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.layoutChoice === l)))
        for (const fv of this.files.values()) if (fv.loaded) this.renderBody(fv)
      })
      b.dataset.layoutChoice = l
      b.setAttribute('aria-pressed', String(this.layout === l))
      return b
    }
    const only = document.createElement('label')
    only.className = 'rv-only'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.dataset.testid = 'review-unviewed-only'
    box.addEventListener('change', () => this.el.classList.toggle('rv-unviewed-only', box.checked))
    const onlyText = document.createElement('span')
    only.append(box, onlyText)
    tools.append(layoutBtn('unified', ''), layoutBtn('split', ''), only, button('', 'review-refresh', () => void this.refresh()))
    // Since the last look: from the working copy, opened; in it, everything marked as seen.
    const s = this.spec
    if (s.kind === 'working') tools.prepend(button('', 'review-open-since', () => this.deps.openSet({ kind: 'since', repo: s.repo })))
    if (s.kind === 'since')
      tools.prepend(
        button('', 'review-all-seen', () =>
          void folio().reviewCheckpoint(s.repo).then((r) => {
            if (!('ok' in r)) this.say(this.failure(r))
            return this.refresh()
          }),
        ),
      )
    // Comments to the agent: in its console, as a paste.
    this.sendButton = button('', 'review-send', () => this.openSend(), 'rv-button rv-send')
    this.sendButton.hidden = true
    tools.prepend(this.sendButton)
    this.head.append(tools)
    this.applyText()
  }

  /** The words again (a language chosen meanwhile). */
  applyText(): void {
    const t = this.t
    const q = (id: string) => this.head.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    for (const [id, text] of [['review-unified', t.unified], ['review-split', t.split], ['review-refresh', t.refresh], ['review-open-since', t.sinceButton], ['review-all-seen', t.allSeen]] as const) {
      const b = q(id)
      if (b) b.textContent = text
    }
    const only = this.head.querySelector('.rv-only span')
    if (only) only.textContent = t.unviewedOnly
    this.head.querySelector('.rv-only')?.setAttribute('title', t.unviewedOnly)
    this.syncHead()
  }

  title(): string {
    const t = this.t
    const s = this.spec
    switch (s.kind) {
      case 'working':
        return t.working.replace('{name}', baseName(s.repo))
      case 'commit':
        return t.commit.replace('{oid}', s.oid.slice(0, 7))
      case 'range':
        return t.range.replace('{from}', /^[0-9a-f]{40}$/.test(s.from) ? s.from.slice(0, 7) : s.from)
      case 'worktree':
        return t.worktree.replace('{name}', baseName(s.path))
      case 'since':
        return t.since.replace('{name}', baseName(s.repo))
    }
  }

  private unsent(): ReviewComment[] {
    const paths = new Set((this.set?.files ?? []).map((f) => f.path))
    return this.comments.filter((c) => !c.sent && paths.has(c.path))
  }

  private syncSend(): void {
    const n = this.unsent().length
    if (this.ask) {
      const request = this.ask.bar.querySelector<HTMLButtonElement>('[data-testid="review-ask-request"]')!
      request.textContent = this.t.agentRequest.replace('{n}', String(n))
      request.disabled = n === 0
      this.ask.bar.querySelector('.rv-ask-hint')!.textContent = n === 0 ? this.t.agentNoComments : ''
    }
    if (!this.sendButton) return
    this.sendButton.hidden = n === 0
    this.sendButton.textContent = this.t.send.replace('{n}', String(n))
  }

  private syncHead(): void {
    this.syncSend()
    this.titleEl.textContent = this.title()
    this.titleEl.title = this.set?.subject ?? ''
    const files = this.set?.files ?? []
    const add = files.reduce((n, f) => n + f.add, 0)
    const del = files.reduce((n, f) => n + f.del, 0)
    this.summary.textContent = this.set ? `${plural(files.length, this.t.files, this.deps.lang())} · +${add} −${del}` : ''
  }

  private say(text: string): void {
    this.message.textContent = text
    this.message.hidden = text === ''
  }

  private failure(r: GitRefusal): string {
    if (r.error === 'no-git') return this.t.noGit
    return this.deps.errors()[r.error] ?? r.detail.join('\n') ?? r.error
  }

  /** The set read again: files come and go, the ones read are read again; what was opened, folded and scrolled stays. */
  refresh(): Promise<void> {
    if (this.loadingSet) {
      this.again = true
      return this.loadingSet
    }
    this.loadingSet = this.load().finally(() => {
      this.loadingSet = null
      if (this.again) {
        this.again = false
        void this.refresh()
      }
    })
    return this.loadingSet
  }

  private async load(): Promise<void> {
    const r = await folio().reviewChangeset(this.spec)
    if (!('ok' in r)) {
      this.say(this.failure(r))
      return
    }
    const first = this.set === null
    this.set = r.set
    if (first) {
      const v = await folio().reviewViewed(r.set.root)
      if ('ok' in v) {
        this.viewed = v.viewed
        this.comments = v.comments
      }
    }
    const edits = await folio().reviewAgentEdits(r.set.root)
    this.agentEdits = new Map('ok' in edits ? edits.edits.filter((e) => e.rel).map((e) => [e.rel!, e]) : [])
    this.syncHead()
    this.deps.titled()
    this.say(r.set.files.length === 0 ? this.t.empty : '')
    const seen = new Set<string>()
    let before: FileView | null = null
    for (const file of r.set.files) {
      seen.add(file.path)
      let fv = this.files.get(file.path)
      if (!fv) fv = this.makeFile(file)
      else {
        const changed = JSON.stringify(fv.file) !== JSON.stringify(file)
        fv.file = file
        this.fillHead(fv)
        // Read again: the disk may have changed though git counts the same.
        if (fv.loaded && (changed || r.set.after === 'disk')) void this.loadTexts(fv)
      }
      // In the set's order.
      const after: ChildNode | null = before ? before.section.nextSibling : this.list.firstChild
      if (fv.section !== after) this.list.insertBefore(fv.section, after)
      const navAfter: ChildNode | null = before ? before.nav.nextSibling : this.navList.firstChild
      if (fv.nav !== navAfter) this.navList.insertBefore(fv.nav, navAfter)
      // A file marked viewed before: read now, to know whether it still is.
      if (!fv.loaded && !fv.loading && this.viewed[this.keyOf(file)]) void this.loadTexts(fv)
      before = fv
    }
    for (const [path, fv] of this.files) {
      if (seen.has(path)) continue
      this.observer.unobserve(fv.section)
      fv.section.remove()
      fv.nav.remove()
      this.files.delete(path)
    }
  }

  private keyOf(file: ChangedFile): string {
    const s = this.spec
    const set = s.kind === 'commit' ? `commit:${s.oid}` : s.kind === 'range' ? `range:${s.from}...${s.to}` : s.kind
    return `${set}|${file.path}`
  }

  private makeFile(file: ChangedFile): FileView {
    const section = document.createElement('section')
    section.className = 'rv-file'
    section.dataset.testid = 'review-file'
    section.dataset.path = file.path
    const head = document.createElement('header')
    head.className = 'rv-file-head'
    const body = document.createElement('div')
    body.className = 'rv-file-body'
    body.textContent = this.t.loading
    // A guess of its height until it is read, so the scroll bar is about right.
    body.style.minHeight = `${Math.min(2000, 40 + (file.add + file.del + 8) * 20)}px`
    section.append(head, body)
    const nav = document.createElement('li')
    nav.className = 'rv-nav-item'
    nav.dataset.testid = 'review-nav'
    const fv: FileView = { file, section, head, body, nav, texts: null, diff: null, hash: null, opened: new Set(), loading: false, loaded: false, folded: false, viewed: false }
    nav.addEventListener('click', () => {
      if (fv.folded && !fv.viewed) this.fold(fv, false)
      section.scrollIntoView({ block: 'start' })
    })
    head.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, input, label')) return
      this.fold(fv, !fv.folded)
    })
    this.files.set(file.path, fv)
    this.fillHead(fv)
    this.observer.observe(section)
    return fv
  }

  private absolute(path: string): string {
    return `${this.set?.root ?? ''}/${path}`
  }

  private fillHead(fv: FileView): void {
    const t = this.t
    const f = fv.file
    const status = document.createElement('span')
    status.className = `rv-status rv-status-${f.status}`
    status.textContent = t.statusLetters[f.status]
    status.title = f.untracked ? t.untracked : f.status
    const name = document.createElement('span')
    name.className = 'rv-path'
    const slash = f.path.lastIndexOf('/')
    const dir = document.createElement('span')
    dir.className = 'rv-dir'
    dir.textContent = slash >= 0 ? f.path.slice(0, slash + 1) : ''
    name.append(dir, f.path.slice(slash + 1))
    if (f.oldPath) {
      const from = document.createElement('span')
      from.className = 'rv-from'
      from.textContent = t.renamedFrom.replace('{path}', f.oldPath)
      name.append(' ', from)
    }
    const stats = document.createElement('span')
    stats.className = 'rv-stats'
    stats.innerHTML = f.binary ? '' : `<span class="rv-add">+${f.add}</span> <span class="rv-del">−${f.del}</span>`
    const fold = document.createElement('span')
    fold.className = 'rv-fold'
    fold.textContent = fv.folded ? '▸' : '▾'
    const actions = document.createElement('span')
    actions.className = 'rv-actions'
    const onDisk = editable(this.spec) && f.status !== 'deleted'
    if (onDisk) actions.append(button(t.edit, 'review-edit', () => this.deps.open(this.absolute(f.path), this.firstChangedLine(fv), true)))
    if (this.spec.kind === 'working') {
      actions.append(
        button(t.stage, 'review-file-stage', () => void this.act('stage', f.path, null)),
        button(t.unstage, 'review-file-unstage', () => void this.act('unstage', f.path, null)),
        button(t.discard, 'review-file-discard', () => void this.act('discard', f.path, null)),
      )
    }
    const viewed = document.createElement('label')
    viewed.className = 'rv-viewed'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = fv.viewed
    box.dataset.testid = 'review-viewed'
    box.disabled = !fv.loaded
    box.addEventListener('change', () => this.markViewed(fv, box.checked))
    viewed.append(box, ` ${t.viewed}`)
    actions.append(viewed)
    // Who edited it, when an agent said so (Claude Code's hook).
    const edit = this.agentEdits.get(f.path)
    const agent = document.createElement('span')
    agent.className = 'rv-agent'
    agent.dataset.testid = 'review-agent'
    if (edit) {
      agent.textContent = t.agent.replace('{session}', edit.session.slice(0, 8))
      agent.title = t.agentTitle.replace('{tool}', edit.tool).replace('{session}', edit.session).replace('{cwd}', edit.cwd)
    }
    agent.hidden = !edit
    const when = document.createElement('span')
    when.className = 'rv-when'
    when.textContent = this.spec.kind === 'since' || this.spec.kind === 'working' ? this.ago(f.mtime) : ''
    fv.head.replaceChildren(fold, status, name, stats, agent, when, actions)
    fv.section.toggleAttribute('data-viewed', fv.viewed)
    fv.section.toggleAttribute('data-folded', fv.folded)
    // Its line in the list of files.
    const navStatus = status.cloneNode(true)
    const navName = document.createElement('span')
    navName.className = 'rv-nav-name'
    navName.textContent = f.path.slice(slash + 1)
    navName.title = f.path
    const navDir = document.createElement('span')
    navDir.className = 'rv-nav-dir'
    navDir.textContent = slash >= 0 ? f.path.slice(0, slash) : ''
    const navWhen = document.createElement('span')
    navWhen.className = 'rv-nav-when'
    navWhen.textContent = this.spec.kind === 'since' ? this.ago(f.mtime) : ''
    fv.nav.replaceChildren(navStatus, navName, navDir, navWhen)
    fv.nav.toggleAttribute('data-viewed', fv.viewed)
  }

  private fold(fv: FileView, folded: boolean): void {
    fv.folded = folded
    fv.body.hidden = folded
    this.fillHead(fv)
  }

  private markViewed(fv: FileView, on: boolean): void {
    // Since the last look: seen now — the checkpoint takes the file as it is, and it leaves the set.
    if (this.spec.kind === 'since') {
      if (on) void folio().reviewCheckpointFile(this.spec.repo, fv.file.path).then(() => this.refresh())
      return
    }
    fv.viewed = on
    if (this.set) {
      const key = this.keyOf(fv.file)
      if (on && fv.hash) this.viewed[key] = fv.hash
      else delete this.viewed[key]
      void folio().reviewSetViewed(this.set.root, key, on ? fv.hash : null)
    }
    this.fold(fv, on)
    // The next file not viewed comes up, as in a pull request.
    if (on) {
      const next = [...this.files.values()].slice([...this.files.values()].indexOf(fv) + 1).find((x) => !x.viewed)
      if (next && fv.section.getBoundingClientRect().top < 0) fv.section.scrollIntoView({ block: 'start' })
    }
  }

  private async loadTexts(fv: FileView): Promise<void> {
    if (fv.loading) return
    fv.loading = true
    try {
      const r = await folio().reviewTexts(this.spec, fv.file)
      if (!('ok' in r)) {
        fv.body.textContent = this.failure(r)
        return
      }
      const texts = r.texts
      const hash = hashOf(`${texts.before ?? '\u0001'}\u0000${texts.after ?? '\u0001'}`)
      const same = fv.loaded && hash === fv.hash && (texts.index ?? null) === (fv.texts?.index ?? null)
      const changedInView = fv.loaded && hash !== fv.hash
      fv.texts = texts
      fv.hash = hash
      fv.loaded = true
      const wasViewed = fv.viewed
      fv.viewed = !!this.set && this.viewed[this.keyOf(fv.file)] === hash
      if (fv.viewed !== wasViewed) fv.folded = fv.viewed
      if (!same) {
        // Changed while in view (an agent at work): marked for a moment.
        this.flash(fv, changedInView)
        fv.diff = texts.binary || texts.tooBig ? null : fileDiff(texts.before, texts.after)
        this.renderBody(fv)
      }
      fv.body.hidden = fv.folded
      this.fillHead(fv)
    } finally {
      fv.loading = false
    }
  }

  private flash(fv: FileView, on: boolean): void {
    if (!on) return
    fv.section.removeAttribute('data-fresh')
    void fv.section.offsetWidth
    fv.section.setAttribute('data-fresh', '')
    setTimeout(() => fv.section.removeAttribute('data-fresh'), 2500)
  }

  /** How long ago a file changed, in the window's language. */
  private ago(ms: number | undefined): string {
    if (!ms) return ''
    const s = Math.round((ms - Date.now()) / 1000)
    const rtf = new Intl.RelativeTimeFormat(this.deps.lang(), { numeric: 'auto', style: 'short' })
    if (s > -60) return rtf.format(s, 'second')
    if (s > -3600) return rtf.format(Math.round(s / 60), 'minute')
    if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour')
    return rtf.format(Math.round(s / 86400), 'day')
  }

  private firstChangedLine(fv: FileView): number | null {
    const h = fv.diff?.hunks[0]
    return h ? h.b + 1 : null
  }

  private async act(action: 'stage' | 'unstage' | 'discard', path: string, hunk: Hunk | null): Promise<void> {
    const fv = this.files.get(path)
    const lines = hunk && fv?.diff ? { before: fv.diff.before.slice(hunk.a, hunk.aEnd), after: fv.diff.after.slice(hunk.b, hunk.bEnd) } : undefined
    // The lines as the texts have them, ends and all, for the main process to find the run again.
    const raw = hunk && fv?.texts ? { before: splitKeep(fv.texts.before).slice(hunk.a, hunk.aEnd), after: splitKeep(fv.texts.after).slice(hunk.b, hunk.bEnd) } : lines
    const r = await folio().reviewAct(this.spec, action, path, hunk ? { ...hunk, lines: raw } : null)
    if (!('ok' in r)) this.say(this.failure(r))
    await this.refresh()
  }

  // Drawing ------------------------------------------------------------------

  private renderBody(fv: FileView): void {
    const t = this.t
    fv.body.style.minHeight = ''
    fv.body.replaceChildren()
    const texts = fv.texts
    if (!texts || !fv.diff) {
      const p = document.createElement('p')
      p.className = 'rv-note'
      p.textContent = texts?.tooBig ? t.tooBig : t.binary
      fv.body.append(p)
      return
    }
    const diff = fv.diff
    const lang = languageOf(baseName(fv.file.path), diff.after[0] ?? diff.before[0] ?? '')
    const paint = (lines: string[], text: string | null) => {
      if (!lang || text === null) return lines.map((l) => escapeHtml(l))
      try {
        return highlightLines(text, lang).map((h) => h.replace(/\r$/, ''))
      } catch {
        return lines.map((l) => escapeHtml(l))
      }
    }
    const htmlBefore = paint(diff.before, texts.before)
    const htmlAfter = paint(diff.after, texts.after)
    const lineHtml = (r: Row, side: 'a' | 'b') => {
      const html = side === 'a' ? htmlBefore[r.a!] ?? '' : htmlAfter[r.b!] ?? ''
      return r.words && r.kind !== 'same' ? markRanges(html, r.words, 'rv-w') : html
    }
    const table = document.createElement('table')
    table.className = `rv-diff rv-${this.layout}`
    const tbody = document.createElement('tbody')
    // Two columns: their widths set here (a fixed table takes them from its first row, a run's head).
    if (this.layout === 'split') {
      const cols = document.createElement('colgroup')
      for (const cls of ['rv-col-n', 'rv-col-code', 'rv-col-n', 'rv-col-code']) {
        const col = document.createElement('col')
        col.className = cls
        cols.append(col)
      }
      table.append(cols)
    }
    table.append(tbody)
    const cols = this.layout === 'split' ? 4 : 3
    const working = this.spec.kind === 'working'
    // Comments: at the lines where they are now; those whose lines are gone, above the file's changes.
    const rowIndex = new Map(diff.rows.map((r, k) => [r, k]))
    const at = new Map<string, ReviewComment[]>()
    const keep = new Set<number>()
    const stale: ReviewComment[] = []
    for (const c of this.comments) {
      if (c.path !== fv.file.path) continue
      const i = anchorOf(c, c.side === 'b' ? diff.after : diff.before)
      const k = i < 0 ? -1 : diff.rows.findIndex((r) => (c.side === 'b' ? r.b === i : r.a === i && r.kind !== 'add'))
      if (k < 0) {
        stale.push(c)
        continue
      }
      keep.add(k)
      const key = `${c.side}:${i}`
      at.set(key, [...(at.get(key) ?? []), c])
    }
    if (stale.length) {
      const box = document.createElement('div')
      box.className = 'rv-stale'
      for (const c of stale) box.append(this.commentBox(fv, c, true))
      fv.body.append(box)
    }
    /** Rows after one: its comments (both sides of a pair). */
    const commentRows = (afterTr: HTMLTableRowElement, keys: string[]) => {
      let anchor = afterTr
      for (const key of keys) {
        for (const c of at.get(key) ?? []) {
          const tr = document.createElement('tr')
          tr.className = 'rv-comment-row'
          const td = tr.insertCell()
          td.colSpan = cols
          td.append(this.commentBox(fv, c, false))
          anchor.after(tr)
          anchor = tr
        }
      }
    }
    /** A "comment" button on a line's number. */
    const plus = (cell: HTMLElement, tr: HTMLTableRowElement, r: Row, side: 'a' | 'b') => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'rv-plus'
      b.textContent = '+'
      b.title = this.t.comment
      b.dataset.testid = 'review-comment-add'
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.openEditor(fv, tr, cols, side, side === 'b' ? r.b! : r.a!, rowIndex.get(r) ?? 0, null)
      })
      cell.prepend(b)
    }
    for (const block of blocksOf(diff, 3, fv.opened, keep)) {
      if (block.kind === 'gap') {
        const tr = tbody.insertRow()
        tr.className = 'rv-gap'
        const td = tr.insertCell()
        td.colSpan = cols
        const b = button(`⋯ ${plural(block.to - block.from, t.hidden, this.deps.lang())}`, 'review-gap', () => {
          fv.opened.add(block.from)
          this.renderBody(fv)
        }, 'rv-gap-button')
        td.append(b)
        continue
      }
      if (block.kind === 'hunk') {
        const h = block.hunk
        const tr = tbody.insertRow()
        tr.className = 'rv-hunk'
        tr.dataset.testid = 'review-hunk'
        const td = tr.insertCell()
        td.colSpan = cols
        const label = document.createElement('span')
        label.className = 'rv-hunk-label'
        label.textContent = `@@ −${h.a + 1},${h.aEnd - h.a} +${h.b + 1},${h.bEnd - h.b} @@`
        td.append(label)
        if (working && texts.index !== undefined) {
          const state = hunkState(texts.before ?? '', texts.index ?? '', texts.after ?? '', h)
          if (state !== 'unstaged') {
            const badge = document.createElement('span')
            badge.className = `rv-badge rv-badge-${state}`
            badge.dataset.testid = 'review-hunk-state'
            badge.textContent = state === 'staged' ? t.staged : t.partly
            td.append(badge)
          }
          const acts = document.createElement('span')
          acts.className = 'rv-hunk-actions'
          if (state !== 'staged') acts.append(button(t.stage, 'review-hunk-stage', () => void this.act('stage', fv.file.path, h)))
          if (state !== 'unstaged') acts.append(button(t.unstage, 'review-hunk-unstage', () => void this.act('unstage', fv.file.path, h)))
          acts.append(button(t.discard, 'review-hunk-discard', () => void this.act('discard', fv.file.path, h)))
          td.append(acts)
        }
        continue
      }
      if (this.layout === 'unified') {
        for (const r of block.rows) {
          const tr = tbody.insertRow()
          tr.className = `rv-row rv-${r.kind}`
          tr.dataset.line = String((r.b ?? r.a ?? 0) + 1)
          if (r.b !== null) tr.dataset.after = String(r.b + 1)
          const na = tr.insertCell()
          na.className = 'rv-n'
          na.textContent = r.a !== null ? String(r.a + 1) : ''
          const nb = tr.insertCell()
          nb.className = 'rv-n'
          nb.textContent = r.b !== null ? String(r.b + 1) : ''
          const code = tr.insertCell()
          code.className = 'rv-code'
          code.innerHTML = `<span class="rv-sign">${r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</span>${lineHtml(r, r.kind === 'del' ? 'a' : 'b')}`
          const side = r.kind === 'del' ? 'a' : 'b'
          plus(side === 'a' ? na : nb, tr, r, side)
          commentRows(tr, side === 'a' ? [`a:${r.a}`] : [`b:${r.b}`])
        }
      } else {
        // Two columns: a run's removed lines beside its added ones.
        const rows = block.rows
        for (let k = 0; k < rows.length; ) {
          const r = rows[k]!
          if (r.kind === 'same') {
            const tr = this.splitRow(tbody, r, r, lineHtml)
            plus(tr.cells[2]!, tr, r, 'b')
            commentRows(tr, [`b:${r.b}`])
            k++
            continue
          }
          const dels: Row[] = []
          const adds: Row[] = []
          while (k < rows.length && rows[k]!.kind !== 'same') {
            const x = rows[k++]!
            if (x.kind === 'del') dels.push(x)
            else adds.push(x)
          }
          for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
            const left = dels[i] ?? null
            const right = adds[i] ?? null
            const tr = this.splitRow(tbody, left, right, lineHtml)
            if (left) plus(tr.cells[0]!, tr, left, 'a')
            if (right) plus(tr.cells[2]!, tr, right, 'b')
            commentRows(tr, [...(left ? [`a:${left.a}`] : []), ...(right ? [`b:${right.b}`] : [])])
          }
        }
      }
    }
    // A double click on a line: the file to edit beside, at that line.
    if (editable(this.spec) && fv.file.status !== 'deleted') {
      table.addEventListener('dblclick', (e) => {
        const tr = (e.target as HTMLElement).closest<HTMLElement>('tr.rv-row')
        if (!tr) return
        const line = Number(tr.dataset.after ?? tr.dataset.line ?? 1)
        this.deps.open(this.absolute(fv.file.path), line, true)
      })
    }
    fv.body.append(table)
  }

  private splitRow(tbody: HTMLTableSectionElement, left: Row | null, right: Row | null, lineHtml: (r: Row, side: 'a' | 'b') => string): HTMLTableRowElement {
    const tr = tbody.insertRow()
    tr.className = `rv-row rv-pair${left?.kind === 'same' ? ' rv-same' : ''}`
    if (right?.b !== null && right?.b !== undefined) tr.dataset.after = String(right.b + 1)
    tr.dataset.line = String(((right?.b ?? left?.a) ?? 0) + 1)
    const cell = (r: Row | null, side: 'a' | 'b') => {
      const n = tr.insertCell()
      const code = tr.insertCell()
      const kind = r === null ? 'none' : r.kind
      n.className = `rv-n rv-${kind}`
      code.className = `rv-code rv-${kind}`
      const no = r ? (side === 'a' ? r.a : r.b) : null
      n.textContent = no !== null && no !== undefined ? String(no + 1) : ''
      code.innerHTML = r ? lineHtml(r, side) : ''
    }
    cell(left, 'a')
    cell(right, 'b')
    return tr
  }

  // Comments (R5) ---------------------------------------------------------------

  private commentBox(fv: FileView, c: ReviewComment, stale: boolean): HTMLElement {
    const t = this.t
    const box = document.createElement('div')
    box.className = 'rv-comment'
    box.dataset.testid = 'review-comment'
    box.toggleAttribute('data-sent', !!c.sent)
    box.toggleAttribute('data-stale', stale)
    const text = document.createElement('div')
    text.className = 'rv-comment-text'
    text.textContent = c.text
    const meta = document.createElement('div')
    meta.className = 'rv-comment-meta'
    const where = document.createElement('span')
    where.textContent = [t.commentOn.replace('{line}', String(c.line)), stale ? t.stale : '', c.sent ? t.sent : ''].filter(Boolean).join(' · ')
    meta.append(where)
    if (!stale) {
      meta.append(
        button(t.commentEdit, 'review-comment-edit', () => {
          const tr = box.closest('tr')
          const diff = fv.diff
          if (!tr || !diff) return
          const i = anchorOf(c, c.side === 'b' ? diff.after : diff.before)
          const k = diff.rows.findIndex((r) => (c.side === 'b' ? r.b === i : r.a === i))
          this.openEditor(fv, tr as HTMLTableRowElement, (tr as HTMLTableRowElement).cells[0]?.colSpan ?? 3, c.side, i, k, c)
        }),
      )
    }
    meta.append(button(t.delete, 'review-comment-delete', () => void this.deleteComments([c.id]).then(() => this.renderBody(fv))))
    box.append(text, meta)
    return box
  }

  /** The field for a comment, under its line (a comment edited: under the comment). */
  private openEditor(fv: FileView, afterTr: HTMLTableRowElement, cols: number, side: 'a' | 'b', index: number, rowIndex: number, existing: ReviewComment | null): void {
    const t = this.t
    fv.body.querySelector('tr.rv-comment-edit')?.remove()
    const tr = document.createElement('tr')
    tr.className = 'rv-comment-edit'
    const td = tr.insertCell()
    td.colSpan = cols
    const area = document.createElement('textarea')
    area.className = 'rv-comment-input'
    area.dataset.testid = 'review-comment-input'
    area.rows = 3
    area.placeholder = t.commentPlaceholder
    area.value = existing?.text ?? ''
    const save = async () => {
      const text = area.value.trim()
      const diff = fv.diff
      if (!text || !diff || !this.set) return
      const lines = side === 'b' ? diff.after : diff.before
      const c: ReviewComment = {
        id: existing?.id ?? crypto.randomUUID(),
        path: fv.file.path,
        side,
        line: index + 1,
        excerpt: excerptOf(lines, index),
        context: contextOf(diff, rowIndex),
        text,
        time: existing?.time ?? Date.now(),
      }
      const r = await folio().reviewCommentSave(this.set.root, c)
      if (!('ok' in r)) return this.say(this.failure(r))
      this.comments = [...this.comments.filter((x) => x.id !== c.id), c]
      this.syncSend()
      this.renderBody(fv)
    }
    area.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void save()
      } else if (e.key === 'Escape') tr.remove()
    })
    const acts = document.createElement('div')
    acts.className = 'rv-comment-actions'
    acts.append(button(t.save, 'review-comment-save', () => void save()), button(t.cancel, 'review-comment-cancel', () => tr.remove()))
    td.append(area, acts)
    afterTr.after(tr)
    area.focus()
  }

  private async deleteComments(ids: string[]): Promise<void> {
    if (!this.set) return
    await folio().reviewCommentDelete(this.set.root, ids)
    this.comments = this.comments.filter((c) => !ids.includes(c.id))
    this.syncSend()
  }

  /** The comments not sent, each where it is now: its line and the rows around it as they read today. */
  private current(): ReviewComment[] {
    return this.unsent().map((c) => {
      const diff = this.files.get(c.path)?.diff
      if (!diff) return c
      const i = anchorOf(c, c.side === 'b' ? diff.after : diff.before)
      const k = i < 0 ? -1 : diff.rows.findIndex((r) => (c.side === 'b' ? r.b === i : r.a === i && r.kind !== 'add'))
      return k < 0 ? c : { ...c, line: i + 1, context: contextOf(diff, k) }
    })
  }

  /** The comments as one text for the agent, by file and line. */
  private composed(comments: ReviewComment[]): string {
    return compose(this.t.intro.replace('{title}', this.title()), [...comments].sort((x, y) => (x.path === y.path ? x.line - y.line : x.path < y.path ? -1 : 1)))
  }

  private markSent(root: string, comments: ReviewComment[]): void {
    void folio()
      .reviewCommentSent(root, comments.map((c) => c.id))
      .then(() => {
        for (const c of this.comments) if (comments.some((x) => x.id === c.id)) c.sent = true
        this.syncSend()
        for (const fv of this.files.values()) if (fv.loaded && comments.some((c) => c.path === fv.file.path)) this.renderBody(fv)
      })
  }

  /**
   * An agent asks the person to look at this set and waits (R7): a bar over
   * the review — approve, or send the comments back. Another request on the
   * same set takes the place of the one before (that one ends unanswered).
   */
  agentAsks(id: number, message: string, done: (a: McpAnswer) => void): void {
    this.endAsk({ decision: 'closed' })
    const t = this.t
    const bar = document.createElement('div')
    bar.className = 'rv-ask'
    bar.dataset.testid = 'review-ask'
    const text = document.createElement('div')
    text.className = 'rv-ask-text'
    const head = document.createElement('strong')
    head.textContent = t.agentWaits
    text.append(head)
    if (message) {
      const note = document.createElement('span')
      note.className = 'rv-ask-message'
      note.dataset.testid = 'review-ask-message'
      note.textContent = message
      text.append(note)
    }
    const hint = document.createElement('span')
    hint.className = 'rv-ask-hint'
    const approve = button(t.agentApprove, 'review-ask-approve', () => this.endAsk({ decision: 'approved' }), 'rv-button rv-primary')
    const request = button('', 'review-ask-request', () => {
      const comments = this.current()
      if (!comments.length || !this.set) return
      const answer: McpAnswer = { decision: 'changes', text: this.composed(comments) }
      this.markSent(this.set.root, comments)
      this.endAsk(answer)
    })
    bar.append(text, hint, request, approve)
    this.ask = { id, done, bar }
    this.head.after(bar)
    this.syncSend()
  }

  /** The agent stopped waiting. */
  agentCancelled(id: number): void {
    if (this.ask?.id === id) {
      this.ask.bar.remove()
      this.ask = null
    }
  }

  private endAsk(answer: McpAnswer): void {
    const ask = this.ask
    if (!ask) return
    this.ask = null
    ask.bar.remove()
    ask.done(answer)
  }

  /** The comments not sent, as one text, to paste into the agent's console — read there, sent with Enter by the reader. */
  private openSend(): void {
    const t = this.t
    const comments = this.current()
    if (!comments.length || !this.set) return
    const root = this.set.root
    this.el.querySelector('.rv-send-dialog')?.remove()
    const dialog = document.createElement('div')
    dialog.className = 'rv-send-dialog'
    dialog.dataset.testid = 'review-send-dialog'
    const box = document.createElement('div')
    box.className = 'rv-send-box'
    const title = document.createElement('h3')
    title.textContent = t.sendTitle
    const area = document.createElement('textarea')
    area.className = 'rv-send-text'
    area.dataset.testid = 'review-send-text'
    area.value = this.composed(comments)
    area.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') dialog.remove()
    })
    const row = document.createElement('div')
    row.className = 'rv-send-row'
    const select = document.createElement('select')
    select.dataset.testid = 'review-send-console'
    const hint = document.createElement('p')
    hint.className = 'rv-send-hint'
    const fill = () => {
      const targets = this.deps.consoles()
      // An agent's console first: in this repository, running an agent.
      const agent = /\b(claude|codex|aider|gemini|opencode|cursor-agent|amp|goose|qwen)\b/i
      const inRepo = (cwd: string) => cwd.replace(/\\/g, '/').toLowerCase().startsWith(root.replace(/\\/g, '/').toLowerCase())
      const score = (x: (typeof targets)[number]) => (x.running && agent.test(x.running) ? 4 : 0) + (inRepo(x.cwd) ? 2 : 0) + (x.running ? 1 : 0)
      const sorted = [...targets].sort((x, y) => score(y) - score(x))
      select.replaceChildren(...sorted.map((x) => new Option(x.running ? `${x.label} — ${x.running}` : x.label, String(x.id))))
      select.hidden = sorted.length === 0
      pasteBtn.disabled = sorted.length === 0
      hint.textContent = sorted.length ? t.sendHint : t.noConsoles
      openBtn.hidden = sorted.length > 0
    }
    const close = () => dialog.remove()
    const pasteBtn = button(t.paste, 'review-send-paste', () => {
      const done = this.deps.paste(Number(select.value), area.value)
      if (done !== 'ok') {
        hint.textContent = done === 'unsafe' ? t.pasteUnsafe : t.noConsoles
        fill()
        if (done === 'unsafe') hint.textContent = t.pasteUnsafe
        return
      }
      this.markSent(root, comments)
      close()
    })
    pasteBtn.classList.add('rv-primary')
    const openBtn = button(t.openConsole, 'review-send-open-console', () => {
      this.deps.openConsole(rootOf(this.spec))
      setTimeout(fill, 600)
    })
    const copyBtn = button(t.copy, 'review-send-copy', () => void navigator.clipboard.writeText(area.value).then(() => (hint.textContent = t.copied)))
    const cancel = button(t.cancel, 'review-send-cancel', close)
    row.append(select, openBtn, pasteBtn, copyBtn, cancel)
    box.append(title, area, hint, row)
    dialog.append(box)
    dialog.addEventListener('mousedown', (e) => e.target === dialog && close())
    dialog.addEventListener('keydown', (e) => e.key === 'Escape' && close())
    this.el.append(dialog)
    fill()
    area.focus()
  }

  destroy(): void {
    this.endAsk({ decision: 'closed' })
    this.observer.disconnect()
  }
}

/** The lines of a text with their ends (as the main process compares them). */
function splitKeep(text: string | null): string[] {
  return text === null || text === '' ? [] : (text.match(/[^\n]*\n|[^\n]+$/g) ?? [])
}
