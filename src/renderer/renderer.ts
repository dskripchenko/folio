/**
 * The window: tabs of documents and quick notes. A tab is read (embed's
 * `<dsk-markdown>`) or edited (`<dsk-markdown-editor>`); what is typed and not
 * saved goes to a buffer in folio-data as it is typed — closing folio, a crash
 * or a restart loses nothing, and the file changes only on Save (ADR-001).
 */
import { folio as bridge, prefs, type BufferData, type Changes, type EditorMode, type OpenResult, type Opened, type SaveResult } from './bridge'
import { diffLines } from './diff'
import { openCloneDialog, type CloneText } from './clone'
import { describeRefusal, HistoryPanel, type HistoryText } from './history'
import { Sidebar, type SidebarText } from './sidebar'
import type { GitRefusal, Version } from './bridge'

const TEXT = {
  en: {
    open: 'Open…',
    welcome: 'Open a Markdown file — or drop it here. ⌘N / Ctrl+N starts a quick note.',
    blocked: 'This document wants to load from the web: {hosts}. Nothing was sent.',
    allowFile: 'Allow for this file',
    allowFolder: 'Allow for its folder',
    close: 'Close',
    edit: 'Edit',
    read: 'Read',
    untitled: 'Quick note',
    conflict: 'The file changed on disk while you were editing it. Your text is kept; nothing was overwritten.',
    takeDisk: 'Take the file from disk',
    keepMine: 'Keep my version',
    missing: 'The file is gone; your text is kept — save it somewhere.',
    saveFailed: 'Not saved: {error}',
    history: 'History',
    versionOf: 'Version of {date}',
    showVersion: 'This version',
    showDiff: 'Changes',
    showSide: 'Side by side',
    restore: 'Restore this version',
    back: 'Back to the document',
    then: 'Then',
    now: 'Now',
    historyPanel: { title: 'History', noFile: 'Open a file to see its history.', outside: 'This file is outside the projects and Shared: no history here.', noHistory: 'This folder keeps no history yet.', start: 'Keep a history', autoCommit: 'Commit when saved', commitNow: 'Commit now', commitPlaceholder: 'What changed…', commit: 'Commit', noVersions: 'No versions of this file yet.', nothingToCommit: 'Nothing to commit: the changes are in the history already.', close: 'Close', scopeFile: 'This file', scopeAll: 'All commits', graph: 'Commit graph', branches: 'Branches', newBranch: 'New branch', create: 'Create', switched: 'On branch {branch}.', remotePlaceholder: 'Remote: https://… or git@…', connect: 'Connect', sync: 'Sync', syncing: 'Syncing…', synced: { 'up-to-date': 'Up to date.', pushed: 'Sent.', pulled: 'Received.', merged: 'Merged and sent.', conflict: 'Conflicts: resolve them in the text, then finish the merge.' }, username: 'User', token: 'Token or password', remember: 'Remember on this computer', signIn: 'Sign in and sync', mergeConflicts: 'Merging: conflicts in {n} file(s). Edit the text between the <<<<<<< and >>>>>>> lines, save, then finish.', mergeReady: 'Merging: every conflict is resolved.', finishMerge: 'Finish the merge', abortMerge: 'Cancel the merge', mergeDone: 'Merged. Sync to send it.', errors: { dirty: 'Save or commit the changes first: {files}', merging: 'A merge is in progress: finish or cancel it first.', 'no-remote': 'No remote yet.', detached: 'Not on a branch.', auth: 'The remote asks for a login ({detail}).', authSystem: 'git could not log in ({detail}). Set up its credentials as for a terminal: a credential helper or an SSH key.', network: 'Could not reach the remote: {detail}', invalid: 'Not a valid name or address.', markers: 'Conflict markers are still in: {files}', exists: 'Already exists: {detail}', canceled: '' } } as HistoryText,
    clone: { title: 'Clone a repository', url: 'Repository address', clone: 'Clone…', cancel: 'Cancel', cloning: 'Cloning…' } as CloneText,
    sidebar: { shared: 'Shared', projects: 'Projects', addProject: 'Add a project folder', cloneRepo: 'Clone a repository', chooseShared: 'Choose the Shared folder', showHidden: 'Show hidden projects', noProjects: 'Add a folder as a project with +.', missing: 'not found', empty: 'No documents yet', ungrouped: 'No group' } as SidebarText,
  },
  ru: {
    open: 'Открыть…',
    welcome: 'Откройте Markdown-файл — или перетащите его сюда. ⌘N / Ctrl+N — быстрая заметка.',
    blocked: 'Документ хочет загрузить из сети: {hosts}. Ничего не отправлено.',
    allowFile: 'Разрешить для файла',
    allowFolder: 'Разрешить для его папки',
    close: 'Закрыть',
    edit: 'Править',
    read: 'Читать',
    untitled: 'Быстрая заметка',
    conflict: 'Пока вы правили, файл изменился на диске. Ваш текст сохранён, ничего не перезаписано.',
    takeDisk: 'Взять файл с диска',
    keepMine: 'Оставить мою версию',
    missing: 'Файла больше нет; ваш текст сохранён — сохраните его куда-нибудь.',
    saveFailed: 'Не сохранено: {error}',
    history: 'История',
    versionOf: 'Версия от {date}',
    showVersion: 'Эта версия',
    showDiff: 'Изменения',
    showSide: 'Рядом',
    restore: 'Вернуть эту версию',
    back: 'К документу',
    then: 'Тогда',
    now: 'Сейчас',
    historyPanel: { title: 'История', noFile: 'Откройте файл, чтобы увидеть его историю.', outside: 'Файл вне проектов и «Общих»: истории здесь нет.', noHistory: 'Эта папка пока не ведёт историю.', start: 'Вести историю', autoCommit: 'Фиксировать при сохранении', commitNow: 'Зафиксировать сейчас', commitPlaceholder: 'Что изменилось…', commit: 'Зафиксировать', noVersions: 'У этого файла пока нет версий.', nothingToCommit: 'Нечего фиксировать: изменения уже в истории.', close: 'Закрыть', scopeFile: 'Этот файл', scopeAll: 'Все коммиты', graph: 'Граф коммитов', branches: 'Ветки', newBranch: 'Новая ветка', create: 'Создать', switched: 'Ветка {branch}.', remotePlaceholder: 'Удалённый репозиторий: https://… или git@…', connect: 'Подключить', sync: 'Синхронизировать', syncing: 'Синхронизация…', synced: { 'up-to-date': 'Всё совпадает.', pushed: 'Отправлено.', pulled: 'Получено.', merged: 'Слито и отправлено.', conflict: 'Конфликты: разрешите их в тексте и завершите слияние.' }, username: 'Пользователь', token: 'Токен или пароль', remember: 'Запомнить на этом компьютере', signIn: 'Войти и синхронизировать', mergeConflicts: 'Слияние: конфликты в файлах — {n}. Поправьте текст между строками <<<<<<< и >>>>>>>, сохраните и завершите.', mergeReady: 'Слияние: все конфликты разрешены.', finishMerge: 'Завершить слияние', abortMerge: 'Отменить слияние', mergeDone: 'Слито. Синхронизируйте, чтобы отправить.', errors: { dirty: 'Сначала сохраните или зафиксируйте изменения: {files}', merging: 'Идёт слияние: сначала завершите или отмените его.', 'no-remote': 'Удалённого репозитория пока нет.', detached: 'Вы не на ветке.', auth: 'Удалённый репозиторий просит войти ({detail}).', authSystem: 'git не смог войти ({detail}). Настройте его вход как для терминала: помощник учётных данных или SSH-ключ.', network: 'Не удалось связаться с удалённым репозиторием: {detail}', invalid: 'Неверное имя или адрес.', markers: 'Маркеры конфликта ещё есть в: {files}', exists: 'Уже существует: {detail}', canceled: '' } } as HistoryText,
    clone: { title: 'Клонировать репозиторий', url: 'Адрес репозитория', clone: 'Клонировать…', cancel: 'Отмена', cloning: 'Клонирование…' } as CloneText,
    sidebar: { shared: 'Общие', projects: 'Проекты', addProject: 'Добавить папку проекта', cloneRepo: 'Клонировать репозиторий', chooseShared: 'Выбрать папку «Общих»', showHidden: 'Показать скрытые проекты', noProjects: 'Добавьте папку проектом кнопкой +.', missing: 'не найдена', empty: 'Документов пока нет', ungrouped: 'Без группы' } as SidebarText,
  },
}

const folio = bridge()
document.documentElement.dataset.platform = folio.platform

let t = TEXT.en
let sharedDir: string | null = null
const tabsEl = document.querySelector<HTMLElement>('.tabs')!
const viewEl = document.querySelector<HTMLElement>('.view')!
const welcomeEl = document.querySelector<HTMLElement>('.welcome')!
const bannerEl = document.querySelector<HTMLElement>('.banner')!
const noticeEl = document.querySelector<HTMLElement>('.notice')!
const editButton = document.querySelector<HTMLButtonElement>('.toggle-edit')!
const historyButton = document.querySelector<HTMLButtonElement>('.toggle-history')!
let lang: 'en' | 'ru' = 'en'

/** How long typing settles before the buffer is written. */
const BUFFER_DELAY = 700

interface Tab {
  /** The file, or null for a quick note. */
  path: string | null
  doc: Opened | null
  error: string | null
  view: 'read' | 'edit'
  mode: EditorMode
  /** The text as it is now, and as it is in the file (null: a note never saved). */
  text: string
  saved: string | null
  /** The hash of `saved`, for telling the file changed meanwhile. */
  baseline: string | null
  buffer: string | null
  conflict: boolean
  blocked: string[]
  scroll: number
  /** A version from the history shown instead of the document. */
  version: { oid: string; text: string; message: string; time: number; mode: 'version' | 'diff' | 'side' } | null
  timer: ReturnType<typeof setTimeout> | null
  pane: HTMLElement
  button: HTMLButtonElement
  label: HTMLElement
}

const tabs: Tab[] = []
let active: Tab | null = null

function applyText(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const value = t[el.dataset.i18n as keyof typeof t]
    if (typeof value === 'string') el.textContent = value
  }
}

function isOpened(r: OpenResult | null): r is Opened {
  return r !== null && !('error' in r)
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isDirty(tab: Tab): boolean {
  return tab.saved === null ? tab.text.trim() !== '' : tab.text !== tab.saved
}

/** A note's name: its first line, without the heading marks. */
function titleOf(tab: Tab): string {
  if (tab.doc) return tab.doc.name
  if (tab.path) return tab.path.split(/[\\/]/).pop() || tab.path
  const first = tab.text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l !== '')
  return first ? first.slice(0, 40) : t.untitled
}

function syncLabel(tab: Tab): void {
  tab.label.textContent = titleOf(tab)
  tab.button.classList.toggle('dirty', isDirty(tab))
  tab.button.classList.toggle('note', tab.path === null)
  tab.button.title = tab.path ?? titleOf(tab)
}

// Drawing -----------------------------------------------------------------------

/** A document drawn read-only: embed's markdown with the document's folder as its base. */
function markdownView(text: string, base: string | undefined): HTMLElement {
  const md = document.createElement('dsk-markdown')
  if (base) {
    md.setAttribute('image-base', base)
    md.setAttribute('link-base', base)
  }
  const source = document.createElement('script')
  source.type = 'text/markdown'
  source.textContent = text
  md.append(source)
  return md
}

/** A version from the history: as it was, its changes against now, or the two side by side. */
function renderVersion(tab: Tab): void {
  const v = tab.version!
  const bar = document.createElement('div')
  bar.className = 'version-bar'
  bar.dataset.testid = 'version-bar'
  const title = document.createElement('span')
  title.className = 'title'
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v.time * 1000))
  const strong = document.createElement('strong')
  strong.textContent = t.versionOf.replace('{date}', date)
  title.append(strong, ` — ${v.message.split('\n')[0] ?? ''}`)
  bar.append(title)
  const modes: [typeof v.mode, string][] = [['version', t.showVersion], ['diff', t.showDiff], ['side', t.showSide]]
  for (const [mode, label] of modes) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.dataset.mode = mode
    b.setAttribute('aria-pressed', String(v.mode === mode))
    b.addEventListener('click', () => {
      v.mode = mode
      render(tab)
    })
    bar.append(b)
  }
  const restore = document.createElement('button')
  restore.type = 'button'
  restore.className = 'restore'
  restore.textContent = t.restore
  restore.addEventListener('click', () => {
    // Into the editor as an unsaved edit: saving it is the person's call.
    tab.text = v.text
    tab.version = null
    tab.view = 'edit'
    render(tab)
    edited(tab)
    showBanners()
    history.show(tab.path)
  })
  const back = document.createElement('button')
  back.type = 'button'
  back.textContent = t.back
  back.addEventListener('click', () => {
    tab.version = null
    render(tab)
    void history.refresh()
  })
  bar.append(restore, back)
  tab.pane.append(bar)
  const base = tab.doc?.base
  if (v.mode === 'version') tab.pane.append(markdownView(v.text, base))
  else if (v.mode === 'diff') {
    const pre = document.createElement('div')
    pre.className = 'diff'
    pre.dataset.testid = 'diff'
    for (const line of diffLines(v.text, tab.text)) {
      const div = document.createElement('div')
      div.className = line.kind
      div.textContent = line.text === '' ? ' ' : line.text
      pre.append(div)
    }
    tab.pane.append(pre)
  } else {
    const grid = document.createElement('div')
    grid.className = 'side-by-side'
    for (const [label, text] of [[t.then, v.text], [t.now, tab.text]] as const) {
      const col = document.createElement('section')
      const h = document.createElement('h4')
      h.textContent = label
      col.append(h, markdownView(text, base))
      grid.append(col)
    }
    tab.pane.append(grid)
  }
}

function render(tab: Tab): void {
  tab.pane.replaceChildren()
  if (tab.version) {
    renderVersion(tab)
    return
  }
  if (tab.error && tab.saved !== null && !tab.buffer) {
    const err = document.createElement('p')
    err.className = 'doc-error'
    err.textContent = tab.error
    tab.pane.append(err)
    return
  }
  const base = tab.doc?.base
  if (tab.view === 'read') {
    const md = document.createElement('dsk-markdown')
    if (base) {
      md.setAttribute('image-base', base)
      md.setAttribute('link-base', base)
    }
    md.setAttribute('toc', '')
    const source = document.createElement('script')
    source.type = 'text/markdown'
    // textContent, not markup: a `</script>` in the text stays text.
    source.textContent = tab.text
    md.append(source)
    tab.pane.append(md)
  } else {
    const ed = document.createElement('dsk-markdown-editor') as HTMLElement & { value: string; mode: string }
    if (base) {
      ed.setAttribute('image-base', base)
      ed.setAttribute('link-base', base)
    }
    ed.setAttribute('mode', tab.mode)
    ed.setAttribute('min-height', 'calc(100vh - 160px)')
    const source = document.createElement('script')
    source.type = 'text/plain'
    source.textContent = tab.text
    ed.append(source)
    ed.addEventListener('input', () => {
      tab.text = ed.value
      edited(tab)
    })
    ed.addEventListener('dsk:modechange', (e) => {
      tab.mode = ((e as CustomEvent).detail?.mode ?? tab.mode) as EditorMode
      edited(tab)
    })
    tab.pane.append(ed)
  }
}

function showBanners(): void {
  // The network consent.
  if (active && active.blocked.length > 0) {
    bannerEl.querySelector('.banner-text')!.textContent = t.blocked.replace('{hosts}', active.blocked.join(', '))
    bannerEl.hidden = false
  } else bannerEl.hidden = true
  // The file and the edit disagree.
  noticeEl.hidden = !(active && (active.conflict || (active.error && active.buffer)))
  if (active && !noticeEl.hidden) {
    noticeEl.querySelector('.notice-text')!.textContent = active.conflict ? t.conflict : t.missing
    noticeEl.querySelector<HTMLElement>('[data-action="disk"]')!.hidden = !active.conflict
    noticeEl.querySelector<HTMLElement>('[data-action="mine"]')!.hidden = !active.conflict
  }
  historyButton.hidden = !active?.path
  historyButton.setAttribute('aria-pressed', String(history.visible))
  editButton.hidden = active === null
  editButton.textContent = active?.view === 'edit' ? t.read : t.edit
  editButton.setAttribute('aria-pressed', String(active?.view === 'edit'))
}

// Buffers -------------------------------------------------------------------------

/** The text changed: mark it, and write the buffer once typing settles. */
function edited(tab: Tab): void {
  syncLabel(tab)
  if (tab.timer) clearTimeout(tab.timer)
  tab.timer = setTimeout(() => flush(tab), BUFFER_DELAY)
}

function flush(tab: Tab): void {
  if (tab.timer) clearTimeout(tab.timer)
  tab.timer = null
  if (isDirty(tab)) {
    tab.buffer ??= crypto.randomUUID()
    const buffer: BufferData = { id: tab.buffer, path: tab.path, text: tab.text, baseline: tab.baseline, mode: tab.mode, scroll: tab === active ? viewEl.scrollTop : tab.scroll }
    folio.writeBuffer(buffer)
  } else if (tab.buffer) {
    folio.dropBuffer(tab.buffer)
    tab.buffer = null
  }
  report()
}

function report(): void {
  const index = active ? tabs.indexOf(active) : -1
  folio.state(
    tabs.map((tab) => ({ path: tab.path, buffer: tab.buffer })),
    index >= 0 ? index : null,
    active?.path ?? null,
  )
}

// Tabs ----------------------------------------------------------------------------

function activate(tab: Tab | null): void {
  if (active && active !== tab) active.scroll = viewEl.scrollTop
  active = tab
  for (const other of tabs) {
    other.pane.hidden = other !== tab
    other.button.setAttribute('aria-selected', String(other === tab))
  }
  welcomeEl.hidden = tab !== null
  sidebar.setActive(tab?.path ?? null)
  history.show(tab?.path ?? null)
  showBanners()
  if (tab) requestAnimationFrame(() => (viewEl.scrollTop = tab.scroll))
  report()
}

function makeTab(init: Partial<Tab> & { path: string | null; text: string; saved: string | null }): Tab {
  const pane = document.createElement('article')
  pane.className = 'doc'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tab'
  button.setAttribute('role', 'tab')
  const label = document.createElement('span')
  label.className = 'label'
  const closer = document.createElement('span')
  closer.className = 'close'
  closer.textContent = '×'
  closer.setAttribute('role', 'button')
  closer.setAttribute('aria-label', t.close)
  button.append(label, closer)
  const tab: Tab = {
    doc: null,
    error: null,
    view: 'read',
    mode: 'visual',
    baseline: null,
    buffer: null,
    conflict: false,
    blocked: [],
    scroll: 0,
    version: null,
    timer: null,
    ...init,
    pane,
    button,
    label,
  }
  pane.dataset.path = tab.path ?? ''
  button.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).classList.contains('close')) void close(tab)
    else activate(tab)
  })
  button.addEventListener('auxclick', (event) => {
    if (event.button === 1) void close(tab)
  })
  tabs.push(tab)
  tabsEl.append(button)
  viewEl.append(pane)
  syncLabel(tab)
  render(tab)
  pane.hidden = true
  return tab
}

/** A file to show: a tab of its own, or the one it already has. */
async function add(result: OpenResult, focus = true): Promise<void> {
  const existing = tabs.find((tab) => tab.path === result.path)
  if (existing) {
    if (focus) activate(existing)
    return
  }
  const tab = isOpened(result)
    ? makeTab({ path: result.path, doc: result, text: result.text, saved: result.text, baseline: await sha256(result.text) })
    : makeTab({ path: result.path, error: result.error, text: '', saved: '' })
  if (focus) activate(tab)
  else report()
}

function newNote(): void {
  const tab = makeTab({ path: null, text: '', saved: null, view: 'edit' })
  activate(tab)
  requestAnimationFrame(() => (tab.pane.querySelector('dsk-markdown-editor') as (HTMLElement & { focus(): void }) | null)?.focus())
}

function remove(tab: Tab): void {
  const i = tabs.indexOf(tab)
  if (i < 0) return
  if (tab.timer) clearTimeout(tab.timer)
  tabs.splice(i, 1)
  tab.pane.remove()
  tab.button.remove()
  if (active === tab) activate(tabs[Math.min(i, tabs.length - 1)] ?? null)
  else report()
}

async function close(tab: Tab): Promise<void> {
  if (isDirty(tab)) {
    activate(tab)
    const choice = await folio.confirmClose(titleOf(tab))
    if (choice === 'cancel') return
    if (choice === 'save' && !(await save(tab, false))) return
  }
  if (tab.buffer) folio.dropBuffer(tab.buffer)
  tab.buffer = null
  remove(tab)
}

function toggleEdit(tab: Tab | null): void {
  if (!tab || (tab.error && !tab.buffer && tab.saved !== null)) return
  const ratio = viewEl.scrollHeight > 0 ? viewEl.scrollTop / viewEl.scrollHeight : 0
  tab.version = null
  tab.view = tab.view === 'edit' ? 'read' : 'edit'
  render(tab)
  showBanners()
  requestAnimationFrame(() => (viewEl.scrollTop = ratio * viewEl.scrollHeight))
}

// Saving ---------------------------------------------------------------------------

function notify(message: string): void {
  const text = noticeEl.querySelector('.notice-text')!
  text.textContent = message
  noticeEl.hidden = false
  for (const b of noticeEl.querySelectorAll<HTMLElement>('button')) b.hidden = true
}

/** Saved: the tab is the file now, the buffer goes. */
function savedAs(tab: Tab, result: Extract<SaveResult, { saved: OpenResult }>): void {
  if (!isOpened(result.saved)) return
  tab.path = result.saved.path
  tab.doc = result.saved
  tab.error = null
  tab.saved = tab.text
  tab.baseline = result.baseline
  tab.conflict = false
  tab.pane.dataset.path = tab.path
  if (tab.buffer) folio.dropBuffer(tab.buffer)
  tab.buffer = null
  syncLabel(tab)
  // The base may be new (a note saved into a folder): its pictures resolve there now.
  if (tab.view === 'read') render(tab)
  sidebar.setActive(active?.path ?? null)
  sidebar.refreshStatus()
  void history.refresh()
  showBanners()
  report()
}

async function save(tab: Tab, as: boolean): Promise<boolean> {
  if (tab.timer) flush(tab)
  const dir = tab.doc?.folder ?? sharedDir
  const result: SaveResult =
    tab.path === null || as || (tab.error !== null && tab.buffer !== null)
      ? await folio.saveAs(tab.text, titleOf(tab), dir)
      : await folio.save(tab.path, tab.text, tab.baseline, false)
  if ('saved' in result) {
    savedAs(tab, result)
    return true
  }
  if ('conflict' in result) {
    tab.conflict = true
    showBanners()
    return false
  }
  if ('error' in result) notify(t.saveFailed.replace('{error}', result.error))
  return false
}

// The file and the edit disagree: take the file, or keep the edit (the next save overwrites).
noticeEl.querySelector('[data-action="disk"]')!.addEventListener('click', async () => {
  const tab = active
  if (!tab?.path) return
  const disk = await folio.disk(tab.path)
  if (!disk) return
  tab.text = tab.saved = disk.text
  tab.baseline = disk.hash
  tab.conflict = false
  render(tab)
  flush(tab)
  syncLabel(tab)
  showBanners()
})
noticeEl.querySelector('[data-action="mine"]')!.addEventListener('click', async () => {
  const tab = active
  if (!tab?.path) return
  const disk = await folio.disk(tab.path)
  tab.saved = disk?.text ?? null
  tab.baseline = disk?.hash ?? null
  tab.conflict = false
  flush(tab)
  syncLabel(tab)
  showBanners()
})

// The sidebar ---------------------------------------------------------------------

const sidebarEl = document.querySelector<HTMLElement>('.sidebar')!
const sidebar = new Sidebar({
  el: sidebarEl,
  text: () => t.sidebar,
  open: (root, rel) => void folio.openEntry(root, rel).then((result) => add(result)),
  clone: () => openClone(),
})
function openClone(): void {
  openCloneDialog(t.clone, (r) => describeRefusal(t.historyPanel.errors, r as GitRefusal))
}
folio.onClone(() => openClone())

const history = new HistoryPanel({
  el: document.querySelector<HTMLElement>('.history')!,
  text: () => t.historyPanel,
  locale: () => lang,
  current: () => active?.version?.oid ?? null,
  openFile: (path) => void folio.open(path).then((result) => add(result)),
  open: async (path: string, v: Version) => {
    const tab = tabs.find((x) => x.path === path)
    const text = await folio.gitTextAt(path, v.oid)
    if (!tab || text === null) return
    tab.version = { oid: v.oid, text, message: v.message, time: v.time, mode: tab.version?.mode ?? 'version' }
    render(tab)
    viewEl.scrollTop = 0
  },
})
function toggleHistory(): void {
  history.setVisible(!history.visible)
  prefs.set('historyOpen', history.visible)
  showBanners()
}
historyButton.addEventListener('click', toggleHistory)
folio.onToggleHistory(() => toggleHistory())
folio.onCommitted((value) => {
  const { path } = value as { path: string }
  if (active?.path === path) void history.refresh()
  sidebar.refreshStatus()
})

// The network consent banner: allow, then draw the document again so what was blocked loads.
for (const button of bannerEl.querySelectorAll<HTMLButtonElement>('button[data-scope]')) {
  button.addEventListener('click', async () => {
    if (!active?.doc || !active.path) return
    const scope = button.dataset.scope === 'folder' ? 'folder' : 'file'
    await folio.allowNetwork(scope, scope === 'folder' ? active.doc.folder : active.path)
    active.blocked = []
    showBanners()
    render(active)
  })
}

folio.onBlocked((value) => {
  const { document: path, hosts } = value as { document: string; hosts: string[] }
  const tab = tabs.find((x) => x.path === path)
  if (!tab) return
  tab.blocked = hosts
  if (tab === active) showBanners()
})
folio.onOpened((value) => void add(value as OpenResult))
folio.onCloseTab(() => {
  if (active) void close(active)
})
folio.onAddProject(() => void sidebar.addProject())
folio.onNewNote(() => newNote())
folio.onSave(() => {
  if (active) void save(active, false)
})
folio.onSaveAs(() => {
  if (active) void save(active, true)
})
folio.onToggleEdit(() => toggleEdit(active))
editButton.addEventListener('click', () => toggleEdit(active))

// A file changed on disk: a clean tab takes it, an edited one is told (nothing is overwritten).
folio.onFsChanged(async (value) => {
  const files = new Set((value as Changes[]).flatMap((c) => c.files))
  for (const tab of tabs) {
    if (!tab.path || !files.has(tab.path)) continue
    const disk = await folio.disk(tab.path)
    if (!disk || disk.text === tab.saved) continue
    if (isDirty(tab)) {
      if (disk.hash !== tab.baseline && disk.text !== tab.text) {
        tab.conflict = true
        if (tab === active) showBanners()
      }
      continue
    }
    const top = viewEl.scrollTop
    tab.text = tab.saved = disk.text
    tab.baseline = disk.hash
    const reopened = await folio.open(tab.path)
    if (isOpened(reopened)) tab.doc = reopened
    if (tab.view === 'read') render(tab)
    else (tab.pane.querySelector('dsk-markdown-editor') as (HTMLElement & { value: string }) | null)?.setAttribute('value', disk.text)
    if (tab === active) requestAnimationFrame(() => (viewEl.scrollTop = top))
  }
})

document.querySelector<HTMLButtonElement>('.open')!.addEventListener('click', async () => {
  for (const result of await folio.openDialog()) await add(result)
})

// Links: a document of the folder opens in a tab, the web and mail leave folio; anchors stay.
viewEl.addEventListener('click', (event) => {
  const a = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
  if (!a || event.defaultPrevented || a.closest('[contenteditable="true"]')) return
  const href = a.href
  if (href.startsWith('folio://app/r/')) {
    event.preventDefault()
    void folio.openUrl(href).then((result) => add(result))
  } else if (/^(https?:|mailto:)/.test(href)) {
    event.preventDefault()
    folio.external(href)
  }
})

// Dropping files on the window opens them.
viewEl.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  viewEl.classList.add('dropping')
})
viewEl.addEventListener('dragleave', () => viewEl.classList.remove('dropping'))
viewEl.addEventListener('drop', async (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  viewEl.classList.remove('dropping')
  for (const file of Array.from(event.dataTransfer.files)) {
    const path = folio.pathOf(file)
    if (path) await add(await folio.open(path))
  }
})

// Shortcuts: the window handles them (the menus only show them), the same on every system.
window.addEventListener(
  'keydown',
  (event) => {
    const mod = folio.platform === 'darwin' ? event.metaKey : event.ctrlKey
    if (!mod || event.altKey) return
    const key = event.key.toLowerCase()
    const act: Record<string, () => void> = {
      n: () => newNote(),
      o: () => void folio.openDialog().then(async (docs) => {
        for (const d of docs) await add(d)
      }),
      s: () => {
        if (active) void save(active, event.shiftKey)
      },
      w: () => {
        if (active) void close(active)
      },
      e: () => toggleEdit(active),
      h: () => {
        if (event.shiftKey) toggleHistory()
      },
      b: () => {
        const hidden = !document.body.classList.contains('no-sidebar')
        document.body.classList.toggle('no-sidebar', hidden)
        prefs.set('sidebarHidden', hidden)
      },
    }
    const fn = act[key]
    if (!fn || (key !== 's' && key !== 'h' && event.shiftKey) || (key === 'h' && !event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    fn()
  },
  true,
)

// Going away: what is still settling is written now.
window.addEventListener('beforeunload', () => {
  for (const tab of tabs) if (tab.timer) flush(tab)
})

// The sidebar: hidden with Cmd/Ctrl+B, its width dragged and remembered.
document.body.classList.toggle('no-sidebar', prefs.get('sidebarHidden', false))
document.documentElement.style.setProperty('--sidebar-width', `${prefs.get('sidebarWidth', 260)}px`)
folio.onToggleSidebar(() => {
  const hidden = !document.body.classList.contains('no-sidebar')
  document.body.classList.toggle('no-sidebar', hidden)
  prefs.set('sidebarHidden', hidden)
})
const resizer = document.querySelector<HTMLElement>('.resizer')!
resizer.addEventListener('pointerdown', (event) => {
  resizer.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent) => {
    const width = Math.min(560, Math.max(180, e.clientX))
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
    prefs.set('sidebarWidth', width)
  }
  resizer.addEventListener('pointermove', move)
  resizer.addEventListener('pointerup', () => resizer.removeEventListener('pointermove', move), { once: true })
})

// A failure while starting is shown, not left as an empty window.
function startupFailed(error: unknown): void {
  const p = welcomeEl.querySelector('p')
  if (p) {
    p.textContent = `folio could not start: ${error instanceof Error ? error.message : String(error)}`
    p.dataset.testid = 'startup-error'
  }
}

// Start: what was open comes back — files, unsaved edits, quick notes.
void folio.startup().then(async ({ tabs: restored, active: activeIndex, locale, shared }) => {
  lang = locale.toLowerCase().startsWith('ru') ? 'ru' : 'en'
  t = TEXT[lang]
  sharedDir = shared
  history.setVisible(prefs.get('historyOpen', false))
  document.documentElement.lang = lang
  applyText()
  window.DskEmbed?.configure({ theme: 'system', locale: lang })
  void sidebar.load()
  for (const r of restored) {
    const doc = isOpened(r.doc) ? r.doc : null
    const b = r.buffer
    if (b) {
      makeTab({
        path: b.path,
        doc,
        error: r.doc && !isOpened(r.doc) ? r.doc.error : null,
        text: b.text,
        // The file as it is now, or what the edit started from when the file is gone.
        saved: b.path === null ? null : doc ? doc.text : '',
        baseline: r.conflict ? b.baseline : doc ? await sha256(doc.text) : b.baseline,
        buffer: b.id,
        view: 'edit',
        mode: b.mode,
        scroll: b.scroll,
        conflict: r.conflict,
      })
    } else if (r.doc) await add(r.doc, false)
  }
  for (const tab of tabs) syncLabel(tab)
  activate(tabs[activeIndex ?? -1] ?? tabs[tabs.length - 1] ?? null)
}).catch(startupFailed)
