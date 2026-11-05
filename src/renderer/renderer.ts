/**
 * The window: tabs of documents and quick notes. A tab is read (embed's
 * `<dsk-markdown>`, or the element of its format — formats.ts) or edited
 * (`<dsk-markdown-editor>`, or the format's editor); what is typed and not
 * saved goes to a buffer in folio-data as it is typed — closing folio, a crash
 * or a restart loses nothing, and the file changes only on Save (ADR-001).
 */
import { folio as bridge, prefs, type BufferData, type Changes, type EditorMode, type Format, type OpenResult, type Opened, type SaveResult } from './bridge'
import { diffLines } from './diff'
import { commands as editorCommands, defaultKeymap, editorConfigFor, indentOptions, keyName, normalizeKey, type CodeEditor, type CompletionSource, type KeyBinding } from '@dskripchenko/code-editor'
import enLocale from '../locales/en.json'
import { setCodeWords } from './code'
import { prettyKey, SettingsDialog, type KeyedCommand } from './settingsDialog'
import { canEdit, editorOf, READ_ONLY_BYTES, viewOf, type SourceEditorElement, type ViewOptions } from './formats'
import type { CodeState } from './code'
import { domTarget, editorTarget, fieldTarget, selectInField, type FindTarget, type WithFindTarget } from './find'
import { FindBar, type Retarget } from './findBar'
import { GoToFile } from './goToFile'
import { SearchPanel } from './searchPanel'
import { ConsolePanel } from './consolePanel'
import { icon, iconButton, type IconName } from './icons'
import { GroupedTabs, SEPARATOR } from './groupedTabs'
import { popMenu, popMenuAt } from './menu'
import { ReviewView } from './review/reviewView'
import { WorktreesPanel } from './worktreesPanel'
import { rootOf, type ChangeSpec } from '../common/review'
import { isTabColor, type TabColor } from '../common/tabGroups'
import { openCloneDialog } from './clone'
import { openPdfDialog, type PdfTarget } from './pdfDialog'
import { Presentation, slidesOf } from './slides'
import { describeRefusal, HistoryPanel } from './history'
import { Sidebar, type SidebarText } from './sidebar'
import { linkSuggester, revealHeading, watchWikiLinks } from './wikilinks'
import { LinksPanel } from './linksPanel'
import { TagsPanel } from './tagsPanel'
import { HoverPreview, type Peeked } from './hoverPreview'
import { watchEmbeds } from './embeds'
import { TasksPanel } from './tasksPanel'
import { ChangesPanel } from './changesPanel'
import { GitMarks } from './gitMarks'
import { CodeNav, type NavItem } from './codeNav'
import { SymbolPalette } from './symbolPalette'
import { parseProblems, ProblemsPanel, type ResolvedProblem } from './problems'
import { bytes, duration, type MediaInfo } from './mediaView'
import { drawn, toDocx, toHtml } from './exportDoc'
import {
  applyTextEdits,
  applyWorkspaceEdit,
  completionsAt,
  definitionAt,
  documentSymbols,
  formattingEdits,
  hoverAt,
  LspBinding,
  referencesAt,
  signatureAt,
  type LspLocation,
  type LspRange,
} from './lsp'
import { GraphPanel } from './graphPanel'
import { StatusBar } from './statusBar'
import { AwakeButton, Resources } from './resources'
import { headingsOf, OutlinePanel, type Heading } from './outline'
import { CommandPalette, type Command } from './commandPalette'

/** The palette's own words and the titles of the commands the menus name only in the main process. */
import type { AwakeState, GitRefusal, I18nState, ResSample, UpdateState, Version, WorkspaceView } from './bridge'

/** The window's words: English until the main process gives the language in use (ADR-005). */
type WindowText = typeof enLocale.window

const folio = bridge()
/** The links panel: made with the rest of the window, below; activating a tab tells it the note in view. */
let linksPanel: LinksPanel | null = null
/** The tags panel: made with the rest of the window; it lists the tags of the project in view. */
let tagsPanel: TagsPanel | null = null
/** The graph of notes: made with the rest of the window, drawn around the note in view. */
let graphPanel: GraphPanel | null = null
/** The tasks of the project in view. */
let tasksPanel: TasksPanel | null = null
let changesPanel: ChangesPanel | null = null
let worktreesPanel: WorktreesPanel | null = null
let symbolPalette: SymbolPalette | null = null
let problemsPanel: ProblemsPanel | null = null
/** The status line under the page. */
let statusBar: StatusBar | null = null
let resources: Resources | null = null
let awakeButton: AwakeButton | null = null
folio.onResSample((s) => resources?.sample(s as ResSample))
folio.onResLimit((e) => resources?.limitEvent(e as Parameters<Resources['limitEvent']>[0]))
folio.onAwake((s) => awakeButton?.update(s as AwakeState))
folio.onMenuReport(() => void folio.saveReport().then((path) => path && notify(t.resources.reportSaved.replace('{path}', path))))
// ADR-008: what the consoles' programs take on their tabs; a console grown big; little room on the disk; a notification clicked.
folio.onResSample((v) => {
  const s = v as ResSample
  const usage = new Map(s.procs.filter((p) => p.kind === 'console' && p.ref).map((p) => [Number(p.ref), { memory: p.memory, cpu: p.cpu }]))
  consolePanel.showUsage(usage, (n) => bytes(n, lang, t.media.units))
})
folio.onResConsole((v) => {
  const e = v as { id: number; name: string; memory: number; cpu: number; why: 'memory' | 'cpu' }
  const r = t.resources
  const message = (e.why === 'memory' ? r.consoleBig.replace('{memory}', bytes(e.memory, lang, t.media.units)) : r.consoleHot).replace('{name}', e.name)
  resources?.toast(message, [
    [r.show, () => void resources?.open()],
    [r.closeConsole, () => void consolePanel.closeConsole(e.id)],
  ])
})
folio.onResDisk((v) => {
  const e = v as { free: number }
  resources?.toast(t.resources.diskLow.replace('{free}', bytes(e.free, lang, t.media.units)), [[t.settingsWindow.clearCaches, () => void folio.clearCaches()]])
})
folio.onConsoleFocus((id) => void consolePanel.focusConsole(Number(id)))
folio.onConsoleCloseTab((id) => void consolePanel.closeConsole(Number(id)))
/** The outline of the note in view. */
let outlinePanel: OutlinePanel | null = null
/** Spelling checked as text is written (folio's setting). */
let spellOn = false
/** The modifier key as the system writes it in shortcuts. */
const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'
document.documentElement.dataset.platform = folio.platform

let t: WindowText = enLocale.window
let sharedDir: string | null = null
const tabsEl = document.querySelector<HTMLElement>('.tabs')!
const viewEl = document.querySelector<HTMLElement>('.view')!
/** The view beside the main one, and the divider between them. */
const besideEl = document.querySelector<HTMLElement>('.view-beside')!
const splitEl = document.querySelector<HTMLElement>('.split')!
const welcomeEl = document.querySelector<HTMLElement>('.welcome')!
const bannerEl = document.querySelector<HTMLElement>('.banner')!
const noticeEl = document.querySelector<HTMLElement>('.notice')!
const railRight = document.querySelector<HTMLElement>('.rail-right')!
let lang = 'en'

/** How long typing settles before the buffer is written. */
const BUFFER_DELAY = 700

let tabSeq = 0

interface Tab {
  /** For the elements of its pane (its toolbar's id). */
  id: number
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
  /** The code view's own state (the levels a log hides), kept over redraws. */
  code: CodeState
  blocked: string[]
  scroll: number
  /** A version from the history shown instead of the document. */
  version: {
    oid: string
    text: string
    message: string
    time: number
    mode: 'version' | 'diff' | 'side'
    /** Another file compared with this one (its name), not a version from the history. */
    compare?: string
  } | null
  timer: ReturnType<typeof setTimeout> | null
  /** A set of changes under review (ADR-006), not a file. */
  review: ReviewView | null
  /** Its own colour, and the group it is in. */
  color: TabColor | null
  group: string | null
  pane: HTMLElement
  button: HTMLButtonElement
  label: HTMLElement
}

const tabs: Tab[] = []
let active: Tab | null = null
/** The tab of the main view, and the one beside it (null: one view). `active` is one of them. */
let mainTab: Tab | null = null
let beside: Tab | null = null

function applyText(): void {
  findBar.setText(t.find)
  goToFile.setText(t.goToFile)
  searchPanel.setText(t.search)
  linksPanel?.setText(t.links)
  tagsPanel?.setText(t.tags)
  graphPanel?.setText(t.graph)
  tasksPanel?.setText(t.tasks)
  changesPanel?.setText(t.changes)
  worktreesPanel?.setText(t.worktrees)
  symbolPalette?.setText(t.symbols)
  problemsPanel?.setText(t.problems)
  outlinePanel?.setText(t.outline)
  statusBar?.setText(t.status)
  syncStatus()
  palette.setText(t.commands)
  consolePanel.setText(consoleText())
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const value = t[el.dataset.i18n as keyof typeof t]
    if (typeof value === 'string') el.textContent = value
  }
}

function isOpened(r: OpenResult | null): r is Opened {
  return r !== null && !('error' in r) && !('external' in r)
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
  if (tab.review) return tab.review.title()
  if (tab.doc) return tab.doc.name
  if (tab.path) return tab.path.split(/[\\/]/).pop() || tab.path
  const first = tab.text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l !== '')
  return first ? first.slice(0, 40) : t.untitled
}

function syncLabel(tab: Tab): void {
  tab.label.textContent = titleOf(tab)
  tab.button.classList.toggle('dirty', isDirty(tab))
  tab.button.classList.toggle('note', tab.path === null && !tab.review)
  tab.button.classList.toggle('review-tab', !!tab.review)
  tab.button.title = tab.path ?? titleOf(tab)
}

// Drawing -----------------------------------------------------------------------

/**
 * The editor's layout on the pane: Markdown alone or beside the page takes the
 * whole workspace (style.css), the visual editor reads as a page.
 */
function markLayout(tab: Tab): void {
  const format = formatOf(tab)
  let edit = ''
  if (tab.view === 'edit' && !tab.version) {
    if (format === 'markdown') edit = tab.mode === 'visual' ? '' : tab.mode
    else if (format === 'diagram' || format === 'asyncapi' || format === 'svg') edit = 'split'
    else if (format === 'text' || format === 'csv') edit = 'source'
  }
  if (edit) tab.pane.dataset.edit = edit
  else delete tab.pane.dataset.edit
  if (tab === active) findBar?.retarget()
}

/** The tab's format: a note is Markdown. */
function formatOf(tab: Tab): Format {
  return tab.doc?.format ?? 'markdown'
}

/** What is known of a shown picture, video or sound (its size, its length), for the status line. */
const mediaInfo = new WeakMap<Tab, MediaInfo>()

const isMediaFormat = (format: Format): boolean => format === 'image' || format === 'video' || format === 'audio' || format === 'svg' || format === 'pdf'

/** A picture's, a video's or a sound's URL, its controls' words, the system's program, its size once known. */
function mediaOptions(tab: Tab): ViewOptions['media'] {
  const doc = tab.doc
  if (!doc || !isMediaFormat(doc.format)) return undefined
  return {
    // A new version of the file is a new URL: the picture is not the cached one.
    src: `${doc.base}${encodeURIComponent(doc.name)}?v=${Math.round(doc.media?.modified ?? 0)}`,
    text: t.media,
    external: () => void folio.openExternal(doc.path),
    info: (info) => {
      mediaInfo.set(tab, info)
      if (tab === active) syncStatus()
    },
  }
}

/** Prose (plain text, Markdown, logs) or code: wrapping is chosen for each, and remembered. */
const wrapKind = (language: string | null): 'prose' | 'code' => (language === null || language === 'markdown' || language === 'log' ? 'prose' : 'code')

/** Whether lines wrap for a kind of text: prose wraps, code does not, unless Alt+Z said otherwise. */
function wrapFor(language: string | null): boolean {
  const kind = wrapKind(language)
  try {
    const saved = localStorage.getItem(`folio.wrap.${kind}`)
    if (saved !== null) return saved === '1'
  } catch {
    // No storage: the defaults.
  }
  return kind === 'prose'
}

/** Alt+Z, as in VS Code: wrapping on or off in the editor in view, and for its kind of text from now on. */
function toggleWrap(): void {
  const editor = codeEditorOf(active)
  if (!editor) return
  const on = !editor.lineWrapping
  editor.lineWrapping = on
  try {
    localStorage.setItem(`folio.wrap.${wrapKind(editor.language)}`, on ? '1' : '0')
  } catch {
    // Not remembered: this editor still changed.
  }
}

/** A table's size (rows below its header, columns), for the status line. */
const tableInfo = new WeakMap<Tab, { rows: number; cols: number }>()

function viewOptions(tab: Tab, main = false): ViewOptions {
  return {
    wrap: wrapFor,
    table: {
      text: t.table,
      lang,
      info: (rows, cols) => {
        tableInfo.set(tab, { rows, cols })
        if (tab === active) syncStatus()
      },
    },
    media: mediaOptions(tab),
    base: tab.doc?.base,
    name: tab.doc?.name ?? titleOf(tab),
    main,
    code: main ? tab.code : undefined,
    completion: async (context) => {
      // The language server's first, then the projects' names it does not have.
      const b = lspOf(tab)
      const fromServer = b ? await completionsAt(b, context.pos, context.explicit, context.prefix) : null
      const names = (await projectCompletion(context)) ?? []
      return [...(fromServer ?? []), ...names.filter((n) => !fromServer?.some((i) => i.label === n.label))]
    },
    keymap: [...editorKeymap, ...lspKeys(tab)],
    hover: ({ pos }) => {
      const b = lspOf(tab)
      return b ? hoverAt(b, pos) : null
    },
    signatureHelp: ({ pos, explicit }) => {
      const b = lspOf(tab)
      return b ? signatureAt(b, pos, explicit) : null
    },
    onModClick: (pos) => {
      const b = lspOf(tab)
      if (!b?.has('definitionProvider')) return false
      void goToDefinition(b, pos)
      return true
    },
  }
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
  if (v.compare) {
    strong.textContent = t.comparedWith.replace('{name}', v.compare)
    title.append(strong)
  } else {
    strong.textContent = t.versionOf.replace('{date}', date)
    title.append(strong, ` — ${v.message.split('\n')[0] ?? ''}`)
  }
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
  restore.textContent = v.compare ? t.takeText : t.restore
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
  if (v.mode === 'version') tab.pane.append(viewOf(formatOf(tab), v.text, viewOptions(tab)))
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
    const labels = v.compare ? [v.compare, titleOf(tab)] : [t.then, t.now]
    for (const [label, text] of [[labels[0]!, v.text], [labels[1]!, tab.text]] as const) {
      const col = document.createElement('section')
      const h = document.createElement('h4')
      h.textContent = label
      col.append(h, viewOf(formatOf(tab), text, viewOptions(tab)))
      grid.append(col)
    }
    tab.pane.append(grid)
  }
}

function render(tab: Tab): void {
  tab.pane.replaceChildren()
  if (tab.review) {
    tab.pane.dataset.format = 'review'
    tab.pane.append(tab.review.el)
    return
  }
  markLayout(tab)
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
  const format = formatOf(tab)
  tab.pane.dataset.format = format
  markLayout(tab)
  if (tab.view === 'read' || !canEdit(format)) {
    tab.pane.append(viewOf(format, tab.text, viewOptions(tab, true)))
  } else if (format !== 'markdown') {
    const el = editorOf(format, tab.text, viewOptions(tab, true), (text) => {
      tab.text = text
      edited(tab)
    })
    tab.pane.append(el)
    // A file in a project with `.editorconfig`: its indentation (else the editor guesses from the text).
    const editor = (el as SourceEditorElement).folioEditor
    const path = tab.path
    // A file under git: its changes against the last commit, in the gutter.
    if (editor && path) void watchChanges(editor, path)
    // Its symbols: the outline, the breadcrumbs, going to one by name.
    const crumbs = (el as SourceEditorElement).folioCrumbs
    if (editor && crumbs)
      navs.set(
        editor,
        new CodeNav(editor, editor.language, crumbs, placeOf(tab), () => syncOutline(), () => {
          const b = lspBindings.get(editor)
          return b ? documentSymbols(b) : Promise.resolve(null)
        }),
      )
    // Its language server (ADR-003).
    if (editor && path) void attachLsp(editor, path)
    // A task's problems in this file, marked in it.
    if (editor && path) {
      editorPaths.set(editor, path)
      markProblems()
    }
    if (editor && path)
      void Promise.all([folio.editorConfigs(path), folio.projectSettings(path)]).then(([files, settings]) => {
        // The project's own settings over .editorconfig's.
        const indent = {
          ...indentOptions(editorConfigFor(path, files)),
          ...(settings.indentUnit ? { indentUnit: settings.indentUnit } : {}),
          ...(settings.tabSize ? { tabSize: settings.tabSize } : {}),
        }
        if (indent.indentUnit || indent.tabSize) editor.configure(indent)
      })
  } else {
    const base = tab.doc?.base
    // The editor's toolbar floats over the page, at hand however far down the text goes; the modes are the rail's.
    const bar = document.createElement('div')
    bar.className = 'doc-toolbar'
    bar.id = `doc-toolbar-${tab.id}`
    bar.dataset.testid = 'doc-toolbar'
    tab.pane.append(bar)
    const ed = document.createElement('dsk-markdown-editor') as HTMLElement & { value: string; mode: string; linkSuggest: unknown; saveImage: unknown }
    ed.setAttribute('toolbar-target', `#${bar.id}`)
    ed.setAttribute('mode-switch', 'false')
    if (base) {
      ed.setAttribute('image-base', base)
      ed.setAttribute('link-base', base)
    }
    ed.setAttribute('mode', tab.mode)
    ed.setAttribute('min-height', 'calc(100vh - 140px)')
    // After `[[`: the notes of the document's root.
    ed.linkSuggest = linkSuggester(() => tab.path, folio.wikiNames)
    // Pictures pasted or dropped: into `attachments/` beside the note; a quick note is saved first.
    ed.saveImage = async (file: File) => {
      if (!tab.path) {
        notify(t.saveBeforePictures)
        return null
      }
      const saved = await folio.saveImage(tab.path, file.name, file.type, new Uint8Array(await file.arrayBuffer()))
      if ('error' in saved) {
        notify(t.pictureNotSaved)
        return null
      }
      return saved.path
    }
    const source = document.createElement('script')
    source.type = 'text/plain'
    // textContent, not markup: a `</script>` in the text stays text.
    source.textContent = tab.text
    ed.append(source)
    ed.addEventListener('input', () => {
      tab.text = ed.value
      edited(tab)
    })
    ed.addEventListener('dsk:modechange', (e) => {
      tab.mode = ((e as CustomEvent).detail?.mode ?? tab.mode) as EditorMode
      markLayout(tab)
      edited(tab)
      syncRail()
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
  syncRail()
}

// The right rail: how the document is shown, then tools; settings at the bottom ------

type ViewMode = 'read' | 'visual' | 'source' | 'split'
const MODES: [ViewMode, IconName][] = [['read', 'read'], ['visual', 'visual'], ['source', 'source'], ['split', 'split']]

/** The modes a document offers: all four for Markdown, read and edit for a drawing with an editor, read alone otherwise. */
function modesOf(tab: Tab | null): Set<ViewMode> {
  if (!tab || (tab.error && !tab.buffer && tab.saved !== null)) return new Set()
  // The welcome document (part of the app): read only.
  if (tab.doc?.readOnly) return new Set(['read'])
  const format = formatOf(tab)
  if (format === 'markdown') return new Set(['read', 'visual', 'source', 'split'])
  // A very big file is read, not edited (the code view goes to 200 MB, the editor to 64).
  return new Set(canEdit(format) && tab.text.length <= READ_ONLY_BYTES ? ['read', 'visual'] : ['read'])
}

function modeOf(tab: Tab): ViewMode {
  if (tab.view === 'read' || tab.version) return 'read'
  return formatOf(tab) === 'markdown' ? (tab.mode as ViewMode) : 'visual'
}

function setMode(tab: Tab | null, mode: ViewMode): void {
  if (!tab || !modesOf(tab).has(mode)) return
  if (mode === 'read') {
    if (tab.view === 'edit' || tab.version) {
      tab.version = null
      toggleEditTo(tab, 'read')
    }
    return syncRail()
  }
  if (formatOf(tab) === 'markdown') {
    tab.mode = mode as EditorMode
    const ed = tab.pane.querySelector<HTMLElement & { mode: string }>('dsk-markdown-editor')
    if (tab.view === 'edit' && ed && !tab.version) {
      ed.mode = mode
      markLayout(tab)
      edited(tab)
    } else toggleEditTo(tab, 'edit')
  } else if (tab.view !== 'edit' || tab.version) toggleEditTo(tab, 'edit')
  syncRail()
}

/** The next mode round the cycle, among those the document offers. */
function nextMode(tab: Tab): ViewMode {
  const offered = MODES.map(([m]) => m).filter((m) => modesOf(tab).has(m))
  return offered[(offered.indexOf(modeOf(tab)) + 1) % offered.length] ?? 'read'
}

function buildRail(): void {
  railRight.replaceChildren()
  const modes = document.createElement('div')
  modes.className = 'rail-group rail-modes'
  // One button goes round the modes; its icon is the mode now, the menu (right click) picks one.
  const cycle = iconButton('read', t.viewModes, () => {
    if (active) setMode(active, nextMode(active))
  }, 'mode')
  cycle.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const tab = active
    if (!tab) return
    const offered = modesOf(tab)
    popMenu(cycle, MODES.filter(([m]) => offered.has(m)).map(([m, name]) => ({ label: t.modeNames[m], icon: name, checked: m === modeOf(tab) ? true : undefined, testid: `mode-pick-${m}`, action: () => setMode(tab, m) })), 'end')
  })
  modes.append(cycle)
  const tools = document.createElement('div')
  tools.className = 'rail-group'
  tools.append(
    iconButton('console', `${t.console.title} (Ctrl+\`)`, () => consolePanel.toggle(null), 'toggle-console'),
    iconButton('search', `${t.search.title} (${mod}⇧F)`, () => (searchPanel.visible ? searchPanel.setVisible(false) : void searchPanel.open()), 'toggle-search'),
    iconButton('outline', t.outline.title, () => outlinePanel?.setVisible(!outlinePanel.visible), 'toggle-outline'),
    iconButton('links', t.links.title, () => linksPanel?.setVisible(!linksPanel.visible), 'toggle-links'),
    iconButton('tag', t.tags.title, () => tagsPanel?.setVisible(!tagsPanel.visible), 'toggle-tags'),
    iconButton('graph', t.graph.title, () => graphPanel?.setVisible(!graphPanel.visible), 'toggle-graph'),
    iconButton('tasks', t.tasks.title, () => tasksPanel?.setVisible(!tasksPanel.visible), 'toggle-tasks'),
    iconButton('commit', `${t.changes.title} (Ctrl+⇧G)`, () => changesPanel?.setVisible(!changesPanel.visible), 'toggle-changes'),
    iconButton('branch', t.worktrees.title, () => worktreesPanel?.setVisible(!worktreesPanel.visible), 'toggle-worktrees'),
    iconButton('alert', t.problems.title, () => problemsPanel?.setVisible(!problemsPanel.visible), 'toggle-problems'),
    iconButton('history', `${t.history} (${mod}⇧H)`, () => toggleHistory(), 'toggle-history'),
    iconButton('print', `${t.print} (${mod}P)`, () => void printActive(), 'rail-print'),
    iconButton('pdf', `${t.exportPdf} (${mod}⇧P)`, () => exportActive(), 'rail-pdf'),
  )
  const bottom = document.createElement('div')
  bottom.className = 'rail-group rail-bottom'
  // What folio takes and staying awake (ADR-007): made once, their words again with the rail's.
  resources ??= new Resources({
    text: () => t.resources,
    units: () => t.media.units,
    lang: () => lang,
    now: () => folio.resNow(),
    past: () => folio.resPast(),
    watch: (on) => folio.resWatch(on),
    end: (pid, ref) => folio.resEnd(pid, ref),
    limit: async () => (await folio.appSettings()).limits.softGb * 1024 ** 3,
    relaunch: () => void folio.relaunch(),
    openLog: () => void folio.openLog(),
    saveReport: () => folio.saveReport(),
    notify: (m) => notify(m),
  })
  awakeButton ??= new AwakeButton({ text: () => t.awake, lang: () => lang, mac: folio.platform === 'darwin', get: () => folio.awakeGet(), set: (how, o) => folio.awakeSet(how, o) })
  resources.refresh()
  void folio.awakeGet().then((s) => awakeButton?.update(s))
  bottom.append(resources.gauge, awakeButton.el, iconButton('settings', t.settings, (e) => openSettings(e.currentTarget as HTMLElement), 'rail-settings'))
  railRight.append(modes, tools, bottom)
  syncRail()
}

function syncRail(): void {
  const cycle = railRight.querySelector<HTMLButtonElement>('[data-testid="mode"]')
  if (cycle) {
    const offered = active ? modesOf(active) : new Set<ViewMode>()
    const current = active ? modeOf(active) : 'read'
    const name = MODES.find(([m]) => m === current)![1]
    cycle.replaceChildren(icon(name))
    cycle.dataset.mode = current
    cycle.disabled = offered.size < 2
    const label = active && offered.size >= 2 ? t.modeNow.replace('{now}', t.modeNames[current]).replace('{next}', t.modeNames[nextMode(active)]) : t.modeNames[current]
    cycle.title = label
    cycle.setAttribute('aria-label', label)
  }
  const tools = railRight.querySelectorAll<HTMLButtonElement>('[data-testid="toggle-history"], [data-testid="rail-print"], [data-testid="rail-pdf"]')
  for (const b of tools) b.disabled = !active
  // The find bar keeps to the page: left of the panels beside it.
  requestAnimationFrame(() => {
    const beside = [...document.querySelectorAll<HTMLElement>('.content > aside')].reduce((w, a) => w + (a.hidden ? 0 : a.offsetWidth), 0)
    document.querySelector<HTMLElement>('.content')!.style.setProperty('--beside', `${beside}px`)
  })
  const cp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-console"]')
  if (cp) {
    cp.setAttribute('aria-pressed', String(consolePanel.visible))
    cp.classList.toggle('on', consolePanel.visible)
  }
  const op = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-outline"]')
  if (op) {
    op.setAttribute('aria-pressed', String(!!outlinePanel?.visible))
    op.classList.toggle('on', !!outlinePanel?.visible)
  }
  const pr = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-problems"]')
  if (pr) {
    pr.setAttribute('aria-pressed', String(!!problemsPanel?.visible))
    pr.classList.toggle('on', !!problemsPanel?.visible)
  }
  const wt = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-worktrees"]')
  if (wt) {
    wt.setAttribute('aria-pressed', String(!!worktreesPanel?.visible))
    wt.classList.toggle('on', !!worktreesPanel?.visible)
  }
  const ch = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-changes"]')
  if (ch) {
    ch.setAttribute('aria-pressed', String(!!changesPanel?.visible))
    ch.classList.toggle('on', !!changesPanel?.visible)
  }
  const kp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-tasks"]')
  if (kp) {
    kp.setAttribute('aria-pressed', String(!!tasksPanel?.visible))
    kp.classList.toggle('on', !!tasksPanel?.visible)
  }
  const gp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-graph"]')
  if (gp) {
    gp.setAttribute('aria-pressed', String(!!graphPanel?.visible))
    gp.classList.toggle('on', !!graphPanel?.visible)
  }
  const tp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-tags"]')
  if (tp) {
    tp.setAttribute('aria-pressed', String(!!tagsPanel?.visible))
    tp.classList.toggle('on', !!tagsPanel?.visible)
  }
  const lp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-links"]')
  if (lp) {
    lp.setAttribute('aria-pressed', String(!!linksPanel?.visible))
    lp.classList.toggle('on', !!linksPanel?.visible)
  }
  const sp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-search"]')
  if (sp) {
    sp.setAttribute('aria-pressed', String(searchPanel.visible))
    sp.classList.toggle('on', searchPanel.visible)
  }
  const h = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-history"]')
  if (h) {
    h.disabled = !active?.path
    h.setAttribute('aria-pressed', String(history.visible))
    h.classList.toggle('on', history.visible)
  }
}

// Settings: the theme, for now; more as folio grows.
type Theme = 'system' | 'light' | 'dark'
let theme: Theme = prefs.get<Theme>('theme', 'system')
function applyTheme(next: Theme): void {
  theme = next
  prefs.set('theme', next)
  if (next === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = next
  window.DskEmbed?.configure({ theme: next })
  consoleTheme()
}
function openSettings(anchor: HTMLElement): void {
  popMenu(anchor, [
    ...(['system', 'light', 'dark'] as const).map((value) => ({ label: t.themes[value], checked: theme === value, testid: `theme-${value}`, action: () => applyTheme(value) })),
    { separator: true, label: '', action: () => undefined },
    // The language: the system's, or one of those there are (built in, or laid in folio-data/locales).
    { label: t.languageSystem, checked: i18n?.choice === null, testid: 'language-system', action: () => void folio.i18nSet(null) },
    ...(i18n?.languages ?? []).map((l) => ({ label: l.name, checked: i18n?.choice === l.code, testid: `language-${l.code}`, action: () => void folio.i18nSet(l.code) })),
    { separator: true, label: '', action: () => undefined },
    { label: folio.platform === 'linux' ? t.spellcheckFetch : t.spellcheck, checked: spellOn, testid: 'spellcheck', action: () => void folio.setSpellcheck(!spellOn).then((on) => (spellOn = on)) },
    { separator: true, label: '', action: () => undefined },
    ...(update.state.status === 'ready' ? [{ label: t.update.restart.replace('{v}', update.state.version), icon: 'history' as const, testid: 'update-restart', action: () => void folio.restartToUpdate() }] : []),
    { label: `${t.update.check} (${update.current})`, disabled: update.state.status === 'checking' || update.state.status === 'downloading', testid: 'update-check', action: () => checkUpdate() },
    { label: t.update.auto, checked: update.auto, testid: 'update-auto', action: () => void folio.setAutoUpdate(!update.auto).then((on) => (update.auto = on)) },
    { separator: true, label: '', action: () => undefined },
    { label: t.settingsWindow.menu, icon: 'settings', testid: 'open-settings', action: () => void settingsDialog.open() },
    { label: t.commands.dailyFolder, icon: 'calendar', testid: 'daily-folder', action: () => void folio.chooseFolder('daily') },
    { label: t.commands.templatesFolder, icon: 'note', testid: 'templates-folder', action: () => void folio.chooseFolder('templates') },
  ], 'end')
}

// Buffers -------------------------------------------------------------------------

/** The note a tab shows, for the links panel: a Markdown file, its text as in the tab. */
function noteOf(tab: Tab | null): { path: string; text: () => string } | null {
  return tab?.path && formatOf(tab) === 'markdown' && !tab.version ? { path: tab.path, text: () => tab.text } : null
}

let changesTimer: ReturnType<typeof setTimeout> | null = null
/** The changes panel looked at again once the disk is quiet. */
function changesSoon(): void {
  if (!changesPanel?.visible) return
  if (changesTimer) clearTimeout(changesTimer)
  changesTimer = setTimeout(() => void changesPanel?.refresh(), 400)
}

let linksTimer: ReturnType<typeof setTimeout> | null = null
/** The links panel drawn again once typing or the disk is quiet. */
function linksSoon(): void {
  if (!linksPanel?.visible && !tagsPanel?.visible && !graphPanel?.visible && !tasksPanel?.visible) return
  if (linksTimer) clearTimeout(linksTimer)
  linksTimer = setTimeout(() => {
    void linksPanel?.refresh()
    void tagsPanel?.refresh()
    void graphPanel?.refresh()
    void tasksPanel?.refresh()
  }, 600)
}

/** The outline for the note in view, and the section the page shows. */
function syncOutline(): void {
  if (!outlinePanel?.visible) return
  const tab = active
  // A file in the code editor: its symbols, the one holding the caret marked.
  const nav = tab && !tab.version ? navOf(tab) : null
  if (nav) {
    outlinePanel.showItems(nav.items)
    outlinePanel.mark(nav.current())
    return
  }
  outlinePanel.show(tab && !tab.version && formatOf(tab) === 'markdown' ? tab.text : null)
  markSection()
}

/** A heading of the note in view, as drawn: the n-th heading with its text (code blocks' own left out). */
function headingElement(tab: Tab, heading: Heading, index: number, all: Heading[]): HTMLElement | null {
  const nth = all.slice(0, index).filter((h) => h.text === heading.text).length
  const found = [...tab.pane.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].filter((el) => !el.closest('pre, .dsk-md__preview, .hover-preview') && el.textContent?.trim() === heading.text)
  return found[nth] ?? null
}

/** The section the page shows: the last heading above its top. */
function markSection(): void {
  const tab = active
  if (!outlinePanel?.visible || !tab || formatOf(tab) !== 'markdown') return
  const scroller = scrollerOf(tab)
  const top = scroller.getBoundingClientRect().top + 48
  const all = [...tab.pane.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].filter((el) => !el.closest('pre, .dsk-md__preview, .hover-preview'))
  let index = -1
  all.forEach((el, i) => {
    if (el.getBoundingClientRect().top <= top) index = i
  })
  outlinePanel.mark(index)
}

/** To a heading: the caret on its line in the source, scrolled to otherwise. */
function goToHeading(heading: Heading, index: number): void {
  const tab = active
  if (!tab) return
  if (heading.kind) {
    navOf(tab)?.go(heading as NavItem)
    return
  }
  const field = [...tab.pane.querySelectorAll('textarea')].find((a) => a.checkVisibility())
  if (field) {
    const at = tab.text.split('\n').slice(0, heading.line).join('\n').length + (heading.line > 0 ? 1 : 0)
    field.focus()
    field.setSelectionRange(at, at)
    // The field scrolls to its caret when it takes the focus again.
    field.blur()
    field.focus()
    return
  }
  const el = headingElement(tab, heading, index, headingsOf(tab.text))
  if (!el) return
  const scroller = scrollerOf(tab)
  scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
}

/** The status line for the document in view: its length, and the caret in its source. */
function syncStatus(): void {
  syncOutline()
  const tab = active
  if (!statusBar) return
  const editor = tab && !tab.version ? codeEditorOf(tab) : null
  if (editor) return statusBar.showEditor(editor, lspStatus.get(editor) ?? null)
  // A table read: its rows and columns.
  const table = tab && !tab.version && formatOf(tab) === 'csv' && tab.view === 'read' ? tableInfo.get(tab) : undefined
  if (table) return statusBar.showParts([t.table.size.replace('{rows}', table.rows.toLocaleString(lang)).replace('{cols}', String(table.cols))])
  // A picture, a video, a sound: its size and length, its bytes, its kind.
  if (tab && !tab.version && tab.doc && isMediaFormat(tab.doc.format)) {
    const info = mediaInfo.get(tab)
    const parts = [
      ...(info?.width && info.height ? [`${info.width} × ${info.height}`] : []),
      ...(info?.duration !== undefined ? [duration(info.duration)] : []),
      ...(tab.doc.media ? [bytes(tab.doc.media.size, lang, t.media.units)] : []),
      tab.doc.name.split('.').pop()!.toUpperCase(),
    ]
    return statusBar.showParts(parts)
  }
  if (!tab || tab.version || tab.review || (formatOf(tab) !== 'markdown' && formatOf(tab) !== 'text')) return statusBar.show(null)
  const field = [...tab.pane.querySelectorAll('textarea')].find((a) => a.checkVisibility()) ?? null
  statusBar.show({ text: tab.text, field: field && document.activeElement === field ? field : null })
}

/** The text changed: mark it, and write the buffer once typing settles. */
function edited(tab: Tab): void {
  syncLabel(tab)
  if (tab === active) syncStatus()
  if (tab === active) linksSoon()
  if (tab.timer) clearTimeout(tab.timer)
  tab.timer = setTimeout(() => flush(tab), BUFFER_DELAY)
}

/** The symbols of the files in code editors, by editor. */
const navs = new Map<CodeEditor, CodeNav>()

/** The code editor in view's symbols, the ones of editors taken off the page let go. */
function navOf(tab: Tab | null): CodeNav | null {
  for (const [editor, nav] of navs)
    if (!editor.dom.isConnected) {
      nav.destroy()
      navs.delete(editor)
    }
  const editor = codeEditorOf(tab)
  return editor ? (navs.get(editor) ?? null) : null
}

/** Where a file is, for its breadcrumbs: its project (or Shared), its folders, its name. */
function placeOf(tab: Tab): string[] {
  const doc = tab.doc
  if (!doc) return [titleOf(tab)]
  const rel = decodeURIComponent(doc.base.replace(/^folio:\/\/app\/r\/[^/]+\/?/, '')).split('/').filter(Boolean)
  return [doc.project ?? (doc.owner === 'shared' ? t.sidebar.shared : doc.folder.split(/[\\/]/).pop() ?? ''), ...rel, doc.name]
}

/** Names from the projects' symbols, for the code editor's completion (read again at most once a minute). */
let projectNames: { at: number; names: Promise<{ name: string; kind: string; container: string }[]> } | null = null
const projectCompletion: CompletionSource = async ({ prefix }) => {
  if (prefix.length < 2) return null
  if (!projectNames || Date.now() - projectNames.at > 60_000) {
    projectNames = {
      at: Date.now(),
      names: folio.projectSymbols().then((list) => {
        const seen = new Map<string, { name: string; kind: string; container: string }>()
        for (const s of list) if (!seen.has(s.name)) seen.set(s.name, s)
        return [...seen.values()]
      }),
    }
  }
  const lower = prefix.toLowerCase()
  return (await projectNames.names)
    .filter((s) => s.name.toLowerCase().startsWith(lower) && s.name !== prefix)
    .slice(0, 40)
    .map((s) => ({ label: s.name, kind: s.kind, detail: s.container || s.kind }))
}

/** Going to a symbol: of the file in the code editor, or of every project. */
function goToSymbol(scope: 'file' | 'project'): void {
  if (scope === 'file') {
    const nav = navOf(active)
    if (!nav) return
    void symbolPalette?.open(
      t.symbols.file,
      async () => nav.items.map((i) => ({ name: i.text, kind: i.kind, container: i.container, line: i.line, column: i.column })),
      (s) => nav.go(s),
    )
    return
  }
  void symbolPalette?.open(
    t.symbols.project,
    async () => (await folio.projectSymbols()).map((s) => ({ name: s.name, kind: s.kind, container: s.container, line: s.line, column: s.column, file: { root: s.root, label: s.label, path: s.path } })),
    (s) =>
      void folio.openEntry(s.file!.root, s.file!.path).then(async (result) => {
        await add(result)
        const tab = active
        if (!tab) return
        // Code is gone to in the editor.
        if (tab.view !== 'edit' && canEdit(formatOf(tab))) toggleEditTo(tab, 'edit')
        requestAnimationFrame(() => codeEditorOf(tab)?.goToLine(s.line + 1, s.column))
      }),
  )
}

// Keys of one's own (folio-data/keybindings.json) ------------------------------------

/** The editor's commands and actions by name, for keybindings.json. */
const EDITOR_ACTIONS = new Set(['undo', 'redo', 'fold', 'unfold', 'goToLine', 'findNext', 'findPrevious', 'complete', 'jumpToBracket'])
let editorKeymap: KeyBinding[] = []
/** folio's own commands (the palette's, `folio.<id>`) by key, as the editor names keys. */
let folioKeys = new Map<string, string>()
/** The editor's keys of one's own: in the editor they are its, over folio's own shortcuts. */
let editorKeys = new Set<string>()

void folio.keybindings().then((list) => applyKeybindings(list))

/** Keys of one's own put to work: the editor's (for editors opened from now on) and folio's (at once). */
function applyKeybindings(list: { key: string; command: string }[]): void {
  const mac = folio.platform === 'darwin'
  const table = editorCommands as unknown as Record<string, unknown>
  editorKeymap = list.flatMap((b): KeyBinding[] => {
    if (EDITOR_ACTIONS.has(b.command)) return [{ key: b.key, run: b.command as KeyBinding['run'], readOnly: true }]
    const run = table[b.command]
    // A command that makes one (insertText('x')) is not bound from a file: only commands themselves.
    return typeof run === 'function' && run.length >= 1 && b.command !== 'insertText' && b.command !== 'typeText' ? [{ key: b.key, run: run as KeyBinding['run'] }] : []
  })
  folioKeys = new Map(list.filter((b) => b.command.startsWith('folio.')).map((b) => [normalizeKey(b.key, mac), b.command.slice(6)]))
  editorKeys = new Set(editorKeymap.map((b) => normalizeKey(mac ? (b.mac ?? b.key) : (b.other ?? b.key), mac)))
}

/** Every command a key can be given: folio's (as the palette has them) and the code editor's (with its own keys). */
function keyedCommands(): KeyedCommand[] {
  const mac = folio.platform === 'darwin'
  const table = editorCommands as unknown as Record<string, unknown>
  const nameOf = new Map<unknown, string>(Object.entries(table).map(([name, fn]) => [fn, name]))
  const editorDefaults = new Map<string, string[]>()
  for (const b of defaultKeymap) {
    const name = typeof b.run === 'string' ? b.run : nameOf.get(b.run)
    if (!name) continue
    const key = mac ? (b.mac ?? b.key) : (b.other ?? b.key)
    editorDefaults.set(name, [...(editorDefaults.get(name) ?? []), prettyKey(key, mac)])
  }
  const editorNames = new Set([...EDITOR_ACTIONS, ...Object.entries(table).filter(([n, fn]) => typeof fn === 'function' && (fn as () => void).length >= 1 && n !== 'insertText' && n !== 'typeText').map(([n]) => n)])
  // copyLineDown → Copy line down.
  const human = (name: string) => name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`)
  return [
    ...commands().map((c) => ({ command: `folio.${c.id}`, title: c.title, group: c.group, defaults: c.keys ? [c.keys] : [] })),
    ...[...editorNames].sort().map((n) => ({ command: n, title: human(n), group: t.settingsWindow.editor, defaults: editorDefaults.get(n) ?? [] })),
  ]
}

const settingsDialog = new SettingsDialog({
  text: () => t.settingsWindow,
  mac: folio.platform === 'darwin',
  commands: () => keyedCommands(),
  bindings: () => folio.keybindings(),
  saveBindings: async (list) => {
    await folio.setKeybindings(list)
    applyKeybindings(list)
  },
  keyName: (e) => keyName(e),
  project: () => (active?.path ? folio.projectSettingsOf(active.path) : Promise.resolve(null)),
  saveProject: async (path, settings) => (await folio.setProjectSettings(path, settings)) !== null,
  languages: () => ({ list: i18n?.languages ?? [], choice: i18n?.choice ?? null }),
  app: () => folio.appSettings(),
  saveApp: async (o) => {
    const saved = await folio.setAppSettings(o)
    resources?.setLimit(saved.limits.softGb * 1024 ** 3)
  },
  lang: () => lang,
  units: () => t.media.units,
  dataSize: () => folio.dataSize(),
  clearCaches: () => folio.clearCaches(),
  chooseLanguage: async (code) => {
    const state = await folio.i18nSet(code)
    // The window may change before the main process's word comes back: at once.
    applyI18n(state, true)
  },
})
document.body.append(settingsDialog.el)

/** A key of one's own for a folio command: run it; true when it was one. */
function folioKey(event: KeyboardEvent): boolean {
  if (folioKeys.size === 0) return false
  const id = folioKeys.get(keyName(event))
  if (!id) return false
  const command = commands().find((c) => c.id === id)
  if (!command || (command.when && !command.when())) return false
  event.preventDefault()
  event.stopPropagation()
  void command.run()
  return true
}

// Language servers (ADR-003) ------------------------------------------------------

const lspBindings = new Map<CodeEditor, LspBinding>()
/** What the status line says of an editor's server: its name, or why there is none. */
const lspStatus = new Map<CodeEditor, { text: string; hint?: string }>()
/** The servers' last diagnostics of each file, as they sent them (for code actions). */
const lspDiagnostics = new Map<string, { range: LspRange; severity?: number; message: string; source?: string; code?: unknown }[]>()

/** Editors taken off the page: their files closed in their servers. */
function sweepLsp(): void {
  for (const [editor, b] of lspBindings)
    if (!editor.dom.isConnected) {
      b.dispose()
      lspBindings.delete(editor)
      lspStatus.delete(editor)
    }
}

function lspOf(tab: Tab | null): LspBinding | null {
  sweepLsp()
  const editor = codeEditorOf(tab)
  return editor ? (lspBindings.get(editor) ?? null) : null
}

function lspByPath(path: string): LspBinding | null {
  sweepLsp()
  for (const b of lspBindings.values()) if (b.path === path || b.real === path) return b
  return null
}

/** A file in the code editor opened in its language server (asked to trust a project's own the first time). */
async function attachLsp(editor: CodeEditor, path: string): Promise<void> {
  sweepLsp()
  const sent = editor.value.replace(/\r\n/g, '\n')
  const r = await folio.lspOpen(path, sent)
  if (!editor.dom.isConnected) {
    if (r.status === 'ok') folio.lspClose(path)
    return
  }
  if (r.status === 'ok') {
    const b = new LspBinding(editor, path, r.server, r.capabilities, folio, r.real)
    lspBindings.set(editor, b)
    lspStatus.set(editor, { text: r.server })
    // Typed while the server was starting: the server gets the text as it is now.
    const now = editor.value.replace(/\r\n/g, '\n')
    if (now !== sent) {
      const lines = sent.split('\n')
      folio.lspChange(path, [{ from: { line: 0, character: 0 }, to: { line: lines.length - 1, character: lines[lines.length - 1]!.length }, text: now }])
    }
    navs.get(editor)?.refresh()
    markLspDiagnostics(path)
  } else if (r.status === 'none') {
    if (r.install) lspStatus.set(editor, { text: t.lsp.none, hint: t.lsp.install.replace('{install}', r.install) })
  } else
    lspStatus.set(editor, {
      text: r.status === 'untrusted' ? t.lsp.untrusted.replace('{server}', r.server) : t.lsp.failed.replace('{server}', r.server),
      ...(r.status === 'failed' ? { hint: r.error } : {}),
    })
  syncStatus()
}

const severityName = (n?: number): 'error' | 'warning' | 'info' => (n === 2 ? 'warning' : n === 3 || n === 4 ? 'info' : 'error')

/** A file's diagnostics from its server: in its editor and in the Problems panel. */
function markLspDiagnostics(path: string, server?: string): void {
  const list = lspDiagnostics.get(path) ?? []
  const b = lspByPath(path)
  if (b) {
    b.editor.setDiagnostics(
      list.map((d) => {
        const from = b.offset(d.range.start)
        return { from, to: Math.max(from, b.offset(d.range.end)), message: d.source ? `${d.message} (${d.source})` : d.message, severity: severityName(d.severity) }
      }),
      'lsp',
    )
  }
  problemsPanel?.set(
    `${server ?? b?.server ?? 'lsp'} · ${path}`,
    list.map((d) => ({ file: path, line: d.range.start.line + 1, column: d.range.start.character + 1, severity: severityName(d.severity), message: d.message, path, task: server ?? b?.server ?? 'lsp' })),
  )
}

folio.onLspDiagnostics((value) => {
  const told = value as { path: string; server: string; list: { range: LspRange; severity?: number; message: string; source?: string }[] }
  const { server, list } = told
  // By the tab's path, when the server names the file another way.
  const path = lspByPath(told.path)?.path ?? told.path
  lspDiagnostics.set(path, list)
  markLspDiagnostics(path, server)
})

folio.onLspApplyEdit((value) => {
  const { id, edit } = value as { id: number; edit: unknown }
  void applyWorkspaceEdit(edit as Parameters<typeof applyWorkspaceEdit>[0], lspByPath, (p, edits) => folio.lspEditFile(p, edits)).then((ok) => folio.lspApplied(id, ok))
})

/** To a place a server named: in this file, or another one opened in the editor. */
function goToLocation(from: LspBinding, loc: LspLocation): void {
  const line = loc.range.start.line + 1
  const column = loc.range.start.character + 1
  if (loc.path === from.path || loc.path === from.real) from.editor.goToLine(line, column)
  else void openInEditor(loc.path, line, column)
}

/** Where a place in the projects is, for a list: the file from its project, the line's text. */
async function chooseLocation(b: LspBinding, list: LspLocation[], title: string): Promise<void> {
  const previews = await folio.fileLines(list.map((l) => ({ path: l.path, line: l.range.start.line })))
  void symbolPalette?.open(
    title,
    async () =>
      list.map((l, i) => ({
        name: previews[i] || l.path.split(/[\\/]/).pop()!,
        kind: 'reference',
        container: `${l.path.split(/[\\/]/).slice(-2).join('/')}:${l.range.start.line + 1}`,
        line: i,
        column: 1,
      })),
    (s) => goToLocation(b, list[s.line]!),
  )
}

async function goToDefinition(b: LspBinding, pos: number): Promise<void> {
  const list = await definitionAt(b, pos)
  if (list.length === 1) goToLocation(b, list[0]!)
  else if (list.length > 1) await chooseLocation(b, list, t.lsp.definitions)
}

/** The keys of what a server knows, as in VS Code: F12, Shift+F12, F2, Cmd/Ctrl+. */
function lspKeys(tab: Tab): KeyBinding[] {
  const act = (fn: (b: LspBinding) => void): KeyBinding['run'] => () => {
    const b = lspOf(tab)
    if (b) fn(b)
    return null
  }
  const head = (b: LspBinding) => b.editor.state.selection.main.head
  return [
    { key: 'F12', run: act((b) => void goToDefinition(b, head(b))), readOnly: true },
    {
      key: 'Shift-F12',
      run: act((b) => void referencesAt(b, head(b)).then((list) => (list.length ? chooseLocation(b, list, t.lsp.references) : undefined))),
      readOnly: true,
    },
    { key: 'F2', run: act((b) => void renameAt(b, head(b))) },
    { key: 'Mod-.', run: act((b) => void codeActionsAt(b)) },
  ]
}

/** F2: a new name typed over the word; the server's edits across the project, one undo a file. */
async function renameAt(b: LspBinding, pos: number): Promise<void> {
  if (!b.has('renameProvider')) return
  const doc = b.editor.state.doc
  let from: number
  let to: number
  const prepared = await b.request<LspRange | { range: LspRange; placeholder: string } | { defaultBehavior: boolean }>('textDocument/prepareRename', b.at(pos))
  if (prepared && 'start' in prepared) [from, to] = [b.offset(prepared.start), b.offset(prepared.end)]
  else if (prepared && 'range' in prepared) [from, to] = [b.offset(prepared.range.start), b.offset(prepared.range.end)]
  else {
    const line = doc.lineAt(pos)
    const m = [...line.text.matchAll(/[\p{L}\p{N}_$]+/gu)].find((x) => line.from + x.index! <= pos && pos <= line.from + x.index! + x[0].length)
    if (!m) return
    from = line.from + m.index!
    to = from + m[0].length
  }
  const old = doc.slice(from, to)
  const name = await b.editor.prompt(from, to, old)
  if (!name || name === old) return
  const edit = await b.request('textDocument/rename', { ...b.at(from), newName: name })
  await applyWorkspaceEdit(edit as Parameters<typeof applyWorkspaceEdit>[0], lspByPath, (p, edits) => folio.lspEditFile(p, edits))
}

/** Cmd/Ctrl+.: the server's actions for the selection (and the problems there), the one chosen applied. */
async function codeActionsAt(b: LspBinding): Promise<void> {
  if (!b.has('codeActionProvider')) return
  const main = b.editor.state.selection.main
  const range = { start: b.position(main.from), end: b.position(main.to) }
  const here = (lspDiagnostics.get(b.path) ?? []).filter((d) => d.range.start.line <= range.end.line && d.range.end.line >= range.start.line)
  type Action = { title: string; edit?: unknown; command?: { command: string; arguments?: unknown[] } | string; arguments?: unknown[]; disabled?: unknown }
  const actions = ((await b.request<Action[]>('textDocument/codeAction', { range, context: { diagnostics: here, triggerKind: 1 } })) ?? []).filter((a) => !a.disabled)
  if (actions.length === 0) return
  const chosen = await b.editor.menu(actions.map((a) => ({ label: a.title })))
  if (chosen === null) return
  let action = actions[chosen]!
  if (!action.edit && !action.command) action = ((await b.request<Action>('codeAction/resolve', action as unknown as Record<string, unknown>)) ?? action)
  if (action.edit) await applyWorkspaceEdit(action.edit as Parameters<typeof applyWorkspaceEdit>[0], lspByPath, (p, edits) => folio.lspEditFile(p, edits))
  // A command (an action's, or a bare one): the server runs it, and may send edits back.
  const command = typeof action.command === 'string' ? { command: action.command, arguments: action.arguments } : action.command
  if (command) await folio.lspWorkspace(b.path, 'workspace/executeCommand', command)
}

/** The output of the server of the file in view, in a tab of its own. */
async function showLspLog(): Promise<void> {
  const path = active?.path
  if (!path) return
  const log = (await folio.lspLog(path)) ?? ''
  const fence = '`'.repeat(3)
  const text = `# ${t.lsp.log}\n\n${fence}text\n${log.split(fence).join("'''")}\n${fence}\n`
  activate(makeTab({ path: null, text, saved: text }))
}

/** The files the code editors edit (for marking a task's problems in them). */
const editorPaths = new Map<CodeEditor, string>()

/** A file opened in the code editor at a line and column. */
async function openInEditor(path: string, line: number, column = 1): Promise<void> {
  await add(await folio.open(path))
  const tab = active
  if (!tab) return
  if (tab.view !== 'edit' && canEdit(formatOf(tab))) toggleEditTo(tab, 'edit')
  requestAnimationFrame(() => codeEditorOf(tab)?.goToLine(line, column))
}

// Tasks and their problems (ADR-002, I3) ---------------------------------------------

/** The output of tasks running, by their console. */
const taskRuns = new Map<number, { name: string; dir: string; out: string }>()
const RECENT_TASKS = 'folio.tasks.recent'

function recentTasks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_TASKS) ?? '[]') as string[]
  } catch {
    return []
  }
}

/** The tasks of the project in view, the ones run lately first; the one chosen run in a console. */
async function chooseTask(): Promise<void> {
  const path = active?.path ?? null
  const found = path ? await folio.projectTasks(path) : null
  const recent = recentTasks()
  const key = (dir: string, name: string) => `${dir}\u0000${name}`
  const tasks = (found?.tasks ?? []).slice().sort((a, b) => {
    const ra = recent.indexOf(key(found!.dir, a.name))
    const rb = recent.indexOf(key(found!.dir, b.name))
    return (ra < 0 ? Infinity : ra) - (rb < 0 ? Infinity : rb)
  })
  void symbolPalette?.open(
    tasks.length ? t.tasks2.run : t.tasks2.none,
    async () => tasks.map((task) => ({ name: task.name, kind: task.source, container: task.command, line: 0, column: 1 })),
    (s) => {
      if (!found) return
      const task = tasks.find((x) => x.name === s.name)!
      try {
        localStorage.setItem(RECENT_TASKS, JSON.stringify([key(found.dir, task.name), ...recent.filter((r) => r !== key(found.dir, task.name))].slice(0, 30)))
      } catch {
        /* this window only */
      }
      void runTask(found.dir, task.name, task.command)
    },
  )
}

async function runTask(dir: string, name: string, command: string): Promise<void> {
  const id = await consolePanel.run(dir, command, name)
  if (id !== null) taskRuns.set(id, { name, dir, out: '' })
}

folio.onConsoleData((id, data) => {
  const run = taskRuns.get(id)
  // Enough to read problems from; a task that writes without end is not kept whole.
  if (run && run.out.length < 4_000_000) run.out += data
})
folio.onConsoleExit((id) => {
  const run = taskRuns.get(id)
  if (!run) return
  taskRuns.delete(id)
  void taskDone(run)
})

/** A task ended: the problems in its output, in the panel (shown when there are some) and in the editors. */
async function taskDone(run: { name: string; dir: string; out: string }): Promise<void> {
  const found = parseProblems(run.out)
  const where = new Map<string, string | null>()
  for (const p of found) if (!where.has(p.file)) where.set(p.file, (await folio.resolveConsolePath(run.dir, p.file))?.path ?? null)
  const list: ResolvedProblem[] = found.map((p) => ({ ...p, path: where.get(p.file) ?? null, task: run.name }))
  problemsPanel?.set(run.name, list)
  if (list.length && problemsPanel && !problemsPanel.visible) problemsPanel.setVisible(true)
  markProblems()
}

/** The problems of the files in code editors, as their diagnostics. */
function markProblems(): void {
  const all = problemsPanel?.all ?? []
  for (const [editor, path] of editorPaths) {
    if (!editor.dom.isConnected) {
      editorPaths.delete(editor)
      continue
    }
    const doc = editor.state.doc
    const mine = all.filter((p) => p.path === path)
    editor.setDiagnostics(
      mine.map((p) => {
        const index = Math.min(doc.lineCount - 1, Math.max(0, p.line - 1))
        const from = Math.min(doc.lineEnd(index), doc.lineStart(index) + Math.max(0, p.column - 1))
        return { from, to: Math.min(doc.lineEnd(index), from + 1), message: p.message, severity: p.severity }
      }),
      'task',
    )
  }
}

/** The editors showing their changes against the last commit, by the file they edit. */
const gitMarks = new Map<CodeEditor, { path: string; marks: GitMarks }>()

async function watchChanges(editor: CodeEditor, path: string): Promise<void> {
  const committed = await folio.gitHeadText(path)
  if (committed === null || !editor.dom.isConnected) return
  const marks = new GitMarks(editor, committed, () => t.gitMarks)
  gitMarks.set(editor, { path, marks })
}

/** The editors showing who changed each line. */
const blamed = new Set<CodeEditor>()

/** Who changed each line of the file in the code editor, as a column by the numbers; again: taken away. */
async function toggleBlame(): Promise<void> {
  const editor = codeEditorOf(active)
  const path = active?.path
  if (!editor || !path) return
  if (blamed.has(editor)) {
    blamed.delete(editor)
    editor.setAnnotations(null)
    return
  }
  blamed.add(editor)
  await showBlame(editor, path)
}

async function showBlame(editor: CodeEditor, path: string): Promise<void> {
  const lines = await folio.gitBlame(path)
  if (!lines || !blamed.has(editor)) return
  const ago = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'narrow' })
  const when = (time: number): string => {
    const days = Math.round((time * 1000 - Date.now()) / 86_400_000)
    if (days > -1) return ago.format(Math.round((time * 1000 - Date.now()) / 3_600_000), 'hour')
    if (days > -45) return ago.format(days, 'day')
    if (days > -545) return ago.format(Math.round(days / 30), 'month')
    return ago.format(Math.round(days / 365), 'year')
  }
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' })
  editor.setAnnotations(
    lines.map((l, line) =>
      l.oid
        ? {
            line,
            text: `${l.author.split(/\s+/)[0] ?? ''} · ${when(l.time)}`,
            title: `${l.summary}\n${l.author} <${l.email}>, ${date.format(new Date(l.time * 1000))}\n${l.oid.slice(0, 8)}`,
          }
        : { line, text: '—', title: t.notCommitted },
    ),
  )
}

/** A commit made: the editors count their marks from it; the ones taken off the page let go. */
async function committedAgain(): Promise<void> {
  for (const [editor, { path, marks }] of gitMarks) {
    if (!editor.dom.isConnected) {
      marks.destroy()
      gitMarks.delete(editor)
      continue
    }
    const committed = await folio.gitHeadText(path)
    if (committed !== null) marks.setCommitted(committed)
    if (blamed.has(editor)) void showBlame(editor, path)
  }
}

/**
 * The project's formatter over the text in the code editor, before it is
 * saved (when the project asks for it): only what changed is changed, so the
 * cursors stay and the formatting is undone as one step.
 */
async function formatBeforeSave(tab: Tab): Promise<void> {
  const editor = codeEditorOf(tab)
  if (!editor || !tab.path) return
  // The language server formats when the project names it the formatter.
  const settings = await folio.projectSettings(tab.path)
  if (settings.formatOnSave && settings.formatter === 'lsp') {
    const b = lspOf(tab)
    const edits = b ? await formattingEdits(b) : null
    if (b && edits?.length) {
      applyTextEdits(b, edits, 'input.format')
      pull(tab)
      tab.text = editor.value
    }
    return
  }
  const before = editor.value
  const formatted = await folio.formatText(tab.path, before)
  if (formatted === null || formatted === before || editor.value !== before) return
  let start = 0
  while (start < before.length && start < formatted.length && before[start] === formatted[start]) start++
  let end = 0
  while (end < before.length - start && end < formatted.length - start && before[before.length - 1 - end] === formatted[formatted.length - 1 - end]) end++
  // Offsets in the editor's text, whose line breaks are always \n.
  const lf = (s: string) => s.replace(/\r\n/g, '\n')
  const from = lf(before.slice(0, start)).length
  const to = from + lf(before.slice(start, before.length - end)).length
  editor.dispatch({ changes: { from, to, insert: lf(formatted.slice(start, formatted.length - end)) }, userEvent: 'input.format' })
  pull(tab)
  tab.text = editor.value
}

/** The source editor's last change, taken now if it waits for typing to pause (a big file). */
function pull(tab: Tab): void {
  tab.pane.querySelector<SourceEditorElement>('.source-editor')?.folioFlush?.()
}

/** The code editor the tab is edited in, when it is the one in view. */
function codeEditorOf(tab: Tab | null): CodeEditor | null {
  if (!tab) return null
  const box = tab.pane.querySelector<SourceEditorElement>('.source-editor')
  return box?.folioEditor && box.checkVisibility() ? box.folioEditor : null
}

function flush(tab: Tab): void {
  pull(tab)
  if (tab.timer) clearTimeout(tab.timer)
  tab.timer = null
  if (isDirty(tab)) {
    tab.buffer ??= crypto.randomUUID()
    const buffer: BufferData = { id: tab.buffer, path: tab.path, text: tab.text, baseline: tab.baseline, mode: tab.mode, scroll: tab === mainTab || tab === beside ? scrollerOf(tab).scrollTop : tab.scroll }
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
    tabs.map((tab) => ({ path: tab.path, buffer: tab.buffer, color: tab.color, group: tab.group, review: tab.review?.spec ?? null })),
    index >= 0 ? index : null,
    active?.path ?? null,
    [...grouped.groups.values()].map(({ id, name, color, collapsed }) => ({ id, name, color, collapsed })),
  )
}

// Tabs ----------------------------------------------------------------------------

/**
 * The tab in use: shown in the main view — or, when it is the one beside,
 * there; the other view keeps its document. Panels, find and the history
 * follow the tab in use.
 */
function activate(tab: Tab | null): void {
  // A tab of a folded group: the group opens.
  if (tab) grouped.unfold(tab)
  const wasShown = tab !== null && (tab === mainTab || tab === beside)
  if (tab !== beside && mainTab && mainTab !== tab) mainTab.scroll = viewEl.scrollTop
  if (tab !== beside) mainTab = tab
  active = tab
  for (const other of tabs) {
    other.pane.hidden = other !== mainTab && other !== beside
    other.button.setAttribute('aria-selected', String(other === tab))
    other.button.classList.toggle('shown', other !== tab && (other === mainTab || other === beside))
    other.button.classList.toggle('beside', other === beside)
  }
  welcomeEl.hidden = mainTab !== null
  sidebar.setActive(tab?.path ?? null)
  history.show(tab?.path ?? null)
  linksPanel?.show(noteOf(tab))
  tagsPanel?.show(tab?.path ?? null)
  graphPanel?.show(tab?.path ?? null)
  tasksPanel?.show(tab?.path ?? null)
  // A review's tab: the changes of its repository.
  changesPanel?.show(tab?.review ? rootOf(tab.review.spec) : (tab?.path ?? null))
  worktreesPanel?.show(tab?.review ? rootOf(tab.review.spec) : (tab?.path ?? null))
  syncStatus()
  showBanners()
  // A tab coming into its view gets its own scroll back; one already shown keeps where it is.
  if (tab && !wasShown) requestAnimationFrame(() => (scrollerOf(tab).scrollTop = tab.scroll))
  if (tab) recheckLinks.get(tab.pane)?.()
  findBar?.retarget()
  report()
}

/** The view a tab is drawn in. */
function scrollerOf(tab: Tab): HTMLElement {
  return tab === beside ? besideEl : viewEl
}

/** A tab beside the main view; the main view keeps (or takes) another tab. */
function openBeside(tab: Tab): void {
  if (tab === beside) return activate(tab)
  // The main view needs a document of its own: the one there, or another open tab.
  const left = tab === mainTab ? (tabs.filter((x) => x !== tab && x !== beside).at(-1) ?? null) : mainTab
  if (!left) return
  if (beside) backToMain(beside)
  tab.scroll = tab === mainTab ? viewEl.scrollTop : tab.scroll
  beside = tab
  besideEl.append(tab.pane)
  besideEl.hidden = false
  splitEl.hidden = false
  document.querySelector('.content')!.classList.add('two-views')
  if (mainTab !== left) {
    mainTab = null
    activate(left)
  }
  activate(tab)
  requestAnimationFrame(() => (besideEl.scrollTop = tab.scroll))
}

/** The document beside goes back among the main view's tabs. */
function backToMain(tab: Tab): void {
  if (tab !== beside) return
  tab.scroll = besideEl.scrollTop
  beside = null
  viewEl.append(tab.pane)
  besideEl.hidden = true
  splitEl.hidden = true
  document.querySelector('.content')!.classList.remove('two-views')
  tab.pane.hidden = tab !== mainTab
  tab.button.classList.remove('beside', 'shown')
}

/** Close the side view: its document stays open, in a tab of the main view. */
function closeBeside(): void {
  const tab = beside
  if (!tab) return
  backToMain(tab)
  activate(active === tab ? mainTab : active)
}

/** Each pane's check of its `[[links]]`: run again when the tab is shown, as files may have come or gone. */
const recheckLinks = new WeakMap<HTMLElement, () => void>()

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
    id: ++tabSeq,
    doc: null,
    error: null,
    view: 'read',
    mode: 'visual',
    baseline: null,
    buffer: null,
    conflict: false,
    code: {},
    blocked: [],
    scroll: 0,
    version: null,
    timer: null,
    color: null,
    group: null,
    review: null,
    ...init,
    pane,
    button,
    label,
  }
  pane.dataset.path = tab.path ?? ''
  recheckLinks.set(pane, watchWikiLinks(pane, () => (formatOf(tab) === 'markdown' && !tab.version ? tab.path : null), folio.wikiExists))
  watchEmbeds(pane, () => (formatOf(tab) === 'markdown' ? tab.path : null), {
    peek: (from, link) => folio.peek(from, link),
    draw: (note, text) => viewOf('markdown', text, { base: note.base, name: note.name }),
    media: embeddedMedia,
  })
  button.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).classList.contains('close')) void close(tab)
    else activate(tab)
  })
  button.addEventListener('auxclick', (event) => {
    if (event.button === 1) void close(tab)
  })
  // Dragged: to another place in the row, or onto the view's right half to open beside.
  button.draggable = true
  button.addEventListener('dragstart', (event) => {
    draggedTab = tab
    event.dataTransfer!.effectAllowed = 'move'
    event.dataTransfer!.setData(TAB_MIME, String(tab.id))
    document.body.classList.add('dragging-tab')
  })
  button.addEventListener('dragend', () => {
    draggedTab = null
    document.body.classList.remove('dragging-tab')
    tabsEl.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'))
    besideDrop.hidden = true
  })
  // Its menu: bookmarked, beside the main view or back, its colour and group; it and others closed.
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    tabMenu(tab, event.clientX, event.clientY)
  })
  tabs.push(tab)
  tabsEl.append(button)
  viewEl.append(pane)
  grouped.paint(tab)
  syncLabel(tab)
  render(tab)
  pane.hidden = true
  return tab
}

/** A file to show: a tab of its own, or the one it already has. */
async function add(result: OpenResult, focus = true, extra: Partial<Pick<Tab, 'color' | 'group'>> = {}): Promise<void> {
  if ('external' in result) return
  const existing = tabs.find((tab) => tab.path === result.path)
  if (existing) {
    if (focus) activate(existing)
    return
  }
  const tab = isOpened(result)
    ? makeTab({ path: result.path, doc: result, text: result.text, saved: result.text, baseline: await sha256(result.text), ...extra })
    : makeTab({ path: result.path, error: result.error, text: '', saved: '', ...extra })
  if (focus) activate(tab)
  else report()
}

/**
 * A picture, a video or a sound embedded in a note (`![[photo.png|300]]`): at
 * the size asked or its own (never wider than the page); a picture opens in its
 * tab on a click.
 */
function embeddedMedia(file: Peeked, size: { width?: number; height?: number }): HTMLElement {
  const src = `${file.base}${encodeURIComponent(file.name)}`
  const fit = (el: HTMLElement) => {
    if (size.width) el.style.width = `${size.width}px`
    if (size.height) el.style.height = `${size.height}px`
  }
  // A PDF: its pages in the viewer, as tall as asked (or a page's worth).
  if (file.media === 'pdf') {
    const frame = document.createElement('iframe')
    frame.className = 'embed-media embed-pdf'
    frame.src = src.replace(/^folio:\/\/app\/r\//, 'folio://app/pdf/')
    frame.title = file.name
    frame.style.width = size.width ? `${size.width}px` : '100%'
    frame.style.height = `${size.height ?? 600}px`
    return frame
  }
  if (file.media === 'video' || file.media === 'audio') {
    const player = document.createElement(file.media === 'video' ? 'dsk-video' : 'dsk-audio')
    player.setAttribute('src', src)
    player.setAttribute(file.media === 'video' ? 'label' : 'track-title', file.name)
    player.setAttribute('preload', 'metadata')
    player.className = 'embed-media'
    fit(player)
    return player
  }
  const img = document.createElement('img')
  img.className = 'embed-media embed-image'
  img.src = src
  img.alt = file.name
  img.loading = 'lazy'
  img.title = file.name
  fit(img)
  img.addEventListener('click', () => void folio.open(file.path).then((r) => add(r)))
  return img
}

/** The last closed tab again, at its place, in its view, scrolled where it was (one gone from disk is skipped). */
async function reopenClosed(): Promise<void> {
  while (closedTabs.length) {
    const last = closedTabs.shift()!
    if (tabs.some((x) => x.path === last.path)) continue
    const result = await folio.open(last.path)
    if (!isOpened(result)) continue
    await add(result, false, { color: last.color })
    const tab = tabs.find((x) => x.path === result.path)
    if (!tab) return
    grouped.move(tab, last.index)
    tab.mode = last.mode
    if (last.view !== tab.view && (last.view === 'read' || canEdit(formatOf(tab)))) {
      tab.view = last.view
      render(tab)
    }
    tab.scroll = last.scroll
    activate(tab)
    // Its document is drawn a moment later (widgets, a slow machine): scrolled once it is tall enough.
    // (A timer, not frames: a window in the background gets few frames.)
    const scroller = scrollerOf(tab)
    let tries = 40
    const settle = () => {
      if (active !== tab) return
      scroller.scrollTop = last.scroll
      tab.scroll = last.scroll
      if (Math.abs(scroller.scrollTop - last.scroll) > 1 && --tries > 0) setTimeout(settle, 50)
    }
    setTimeout(settle, 0)
    return
  }
}

/** A tab to another place in the row (and its session order); dragged, it joins or leaves a group by where it lands. */
// Colours and groups -------------------------------------------------------------

const grouped = new GroupedTabs<Tab>({
  row: tabsEl,
  tabs,
  text: () => t.tabMenu,
  active: () => active,
  activate: (tab) => activate(tab),
  close: (list) => void closeTabs(list),
  changed: () => report(),
  dragged: () => draggedTab,
})

function tabMenu(tab: Tab, x: number, y: number): void {
  const m = t.tabMenu
  const i = tabs.indexOf(tab)
  const others = tabs.filter((o) => o !== tab)
  const right = tabs.slice(i + 1)
  popMenuAt(x, y, [
    ...(tab.path
      ? [
          { label: m.reveal, testid: 'tab-reveal', icon: 'folder' as const, action: () => void sidebar.reveal(tab.path!) },
          bookmarked(tab.path)
            ? { label: t.commands.unbookmark, testid: 'tab-unbookmark', action: () => void folio.bookmark(tab.path!, false) }
            : { label: t.commands.bookmark, testid: 'tab-bookmark', action: () => void folio.bookmark(tab.path!, true) },
        ]
      : []),
    tab === beside
      ? { label: t.backToMain, testid: 'tab-back', action: () => closeBeside() }
      : { label: t.openBeside, testid: 'tab-beside', disabled: others.length === 0, action: () => openBeside(tab) },
    SEPARATOR,
    ...grouped.tabItems(tab, x, y),
    SEPARATOR,
    { label: t.close, testid: 'tab-close', action: () => void close(tab) },
    { label: m.closeOthers, testid: 'tab-close-others', disabled: others.length === 0, action: () => void closeTabs(others) },
    { label: m.closeRight, testid: 'tab-close-right', disabled: right.length === 0, action: () => void closeTabs(right) },
    { label: m.closeSaved, testid: 'tab-close-saved', disabled: !tabs.some((o) => !isDirty(o)), action: () => void closeTabs(tabs.filter((o) => !isDirty(o))) },
    { label: m.closeAll, testid: 'tab-close-all', action: () => void closeTabs(tabs) },
  ])
}

/**
 * Tabs closed: the saved ones first, then each with changes, asked about in
 * turn; a Cancel stops there.
 */
async function closeTabs(list: readonly Tab[]): Promise<void> {
  const order = [...list.filter((o) => !isDirty(o)), ...list.filter((o) => isDirty(o))]
  for (const tab of order) {
    if (!tabs.includes(tab)) continue
    if (!(await close(tab))) return
  }
}

// A tab dragged: to another place in the row, or onto the view's right half to open beside it.
const TAB_MIME = 'application/x-folio-tab'
let draggedTab: Tab | null = null
const besideDrop = document.createElement('div')
besideDrop.className = 'beside-drop'
besideDrop.dataset.testid = 'beside-drop'
besideDrop.hidden = true
document.querySelector<HTMLElement>('.content')!.append(besideDrop)

/** Where in the row a point falls: the tab it is before (null: the end). */
function tabAt(x: number): Tab | null {
  for (const tab of tabs) {
    if (tab.button.hidden) continue
    const r = tab.button.getBoundingClientRect()
    if (x < r.left + r.width / 2) return tab
  }
  return null
}

tabsEl.addEventListener('dragover', (event) => {
  if (!draggedTab) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
  tabsEl.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'))
  const before = tabAt(event.clientX)
  if (before) before.button.classList.add('drop-before')
  else tabs.at(-1)?.button.classList.add('drop-after')
})
tabsEl.addEventListener('drop', (event) => {
  const tab = draggedTab
  if (!tab) return
  event.preventDefault()
  const before = tabAt(event.clientX)
  const without = tabs.filter((x) => x !== tab)
  grouped.move(tab, before && before !== tab ? without.indexOf(before) : before === tab ? tabs.indexOf(tab) : without.length, true)
})
const contentEl = document.querySelector<HTMLElement>('.content')!
// Caught on the way down: the editors inside (a contenteditable takes drops) never see a tab dragged.
contentEl.addEventListener('dragover', (event) => {
  if (!draggedTab) return
  event.stopPropagation()
  const box = contentEl.getBoundingClientRect()
  const right = event.clientX > box.left + box.width / 2
  // The right half: beside (when there is another tab for the main view); the left: back to the main view.
  const can = right ? draggedTab !== beside && tabs.length > 1 : draggedTab === beside
  besideDrop.hidden = !can
  besideDrop.classList.toggle('beside-drop--left', !right)
  if (!can) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
}, true)
contentEl.addEventListener('dragleave', (event) => {
  if (!contentEl.contains(event.relatedTarget as Node | null)) besideDrop.hidden = true
})
contentEl.addEventListener('drop', (event) => {
  const tab = draggedTab
  besideDrop.hidden = true
  if (!tab) return
  event.preventDefault()
  event.stopPropagation()
  const box = contentEl.getBoundingClientRect()
  if (event.clientX > box.left + box.width / 2) openBeside(tab)
  else if (tab === beside) closeBeside()
}, true)

// The review (ADR-006) ------------------------------------------------------------

const specKey = (s: ChangeSpec) => JSON.stringify(s)

/** A set of changes in a tab of its own: the one it already has, or a new one. */
function openReview(spec: ChangeSpec, focus = true, look: Partial<Pick<Tab, 'color' | 'group'>> = {}): Tab {
  const existing = tabs.find((x) => x.review && specKey(x.review.spec) === specKey(spec))
  if (existing) {
    if (focus) activate(existing)
    void existing.review!.refresh()
    return existing
  }
  let tab: Tab | null = null
  const review = new ReviewView(spec, {
    text: () => t.review,
    errors: () => t.historyPanel.errors,
    lang: () => lang,
    open: (path, line, edit) => void openToEdit(path, line, edit),
    titled: () => tab && syncLabel(tab),
    openSet: (s) => void openReview(s),
    consoles: () => consolePanel.targets(),
    paste: (id, text) => consolePanel.pasteTo(id, text),
    openConsole: (cwd) => void consolePanel.open(cwd),
  })
  tab = makeTab({ path: null, text: '', saved: '', review, ...look })
  void review.refresh()
  if (focus) activate(tab)
  else report()
  return tab
}

/** A file from the review: beside it, to edit, at a line. */
async function openToEdit(path: string, line: number | null, edit: boolean): Promise<void> {
  const from = active
  await add(await folio.open(path), false)
  const tab = tabs.find((x) => x.path && samePath(x.path, path))
  if (!tab) return
  if (edit && tab.view !== 'edit') toggleEditTo(tab, 'edit')
  if (from?.review && tab !== beside) {
    if (mainTab !== from) activate(from)
    openBeside(tab)
  } else activate(tab)
  if (!line) return
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const editor = codeEditorOf(tab)
      if (editor) editor.goToLine(line)
      else tab.pane.querySelector<HTMLElement & { folioGoTo?: (n: number) => void }>('.code-view')?.folioGoTo?.(line)
    }),
  )
}

const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** The repository of what is in view: the active file's, else the changes panel's. */
async function repoInView(): Promise<string | null> {
  if (active?.review) {
    const s = active.review.spec
    return s.kind === 'worktree' ? s.path : s.repo
  }
  if (active?.path) {
    const info = await folio.gitInfo(active.path)
    if (info?.root) return info.root
  }
  return changesPanel?.root ?? null
}

async function reviewWorking(): Promise<void> {
  const repo = await repoInView()
  if (repo) openReview({ kind: 'working', repo })
}

/** Claude Code's hook in the repository in view (R6): added after asking, or taken out. */
async function claudeConnect(on: boolean): Promise<void> {
  const repo = await repoInView()
  if (!repo) return
  const r = await folio.reviewClaudeConnect(repo, on)
  if ('error' in r) notify(r.error === 'invalid' ? t.commands.claudeUnreadable : describeRefusal(t.historyPanel.errors, r))
  else if (r.ok) {
    const mcp = 'mcp' in r ? r.mcp : undefined
    notify(mcp && !mcp.ok ? t.commands.claudeMcpFailed.replace('{output}', mcp.output.split('\n').slice(-2).join(' ') || '—').replace('{command}', mcp.command) : on ? t.commands.claudeConnected : t.commands.claudeDisconnected)
    reviewsSoon()
  }
}

let reviewTimer: ReturnType<typeof setTimeout> | null = null
/** Open reviews read again a moment after files or the repository change (an agent writes in bursts). */
function reviewsSoon(): void {
  if (!tabs.some((x) => x.review)) return
  if (reviewTimer) clearTimeout(reviewTimer)
  reviewTimer = setTimeout(() => {
    reviewTimer = null
    for (const x of tabs) if (x.review) void x.review.refresh()
  }, 400)
}

function newNote(): void {
  const tab = makeTab({ path: null, text: '', saved: null, view: 'edit' })
  activate(tab)
  // At once, and again on the next frame (the editor may come up only then): a window not in front gets few frames.
  const focus = () => (tab.pane.querySelector('dsk-markdown-editor') as (HTMLElement & { focus(): void }) | null)?.focus()
  focus()
  requestAnimationFrame(focus)
}

/** Closed tabs of files, last first: reopened with Cmd/Ctrl+Shift+T where they were. */
const closedTabs: { path: string; index: number; view: Tab['view']; mode: EditorMode; scroll: number; color: TabColor | null }[] = []

function remove(tab: Tab): void {
  const i = tabs.indexOf(tab)
  if (i < 0) return
  if (tab.path) {
    const scroll = tab === mainTab ? viewEl.scrollTop : tab === beside ? besideEl.scrollTop : tab.scroll
    closedTabs.unshift({ path: tab.path, index: i, view: tab.view, mode: tab.mode, scroll, color: tab.color })
    closedTabs.splice(30)
  }
  if (tab.timer) clearTimeout(tab.timer)
  tab.review?.destroy()
  tabs.splice(i, 1)
  if (tab === beside) backToMain(tab)
  tab.pane.remove()
  tab.button.remove()
  if (tab.group) grouped.layout()
  if (tab === mainTab) {
    // The main view takes a neighbour, never the document beside.
    const rest = tabs.filter((x) => x !== beside)
    mainTab = null
    const next = rest[Math.min(i, rest.length - 1)] ?? null
    if (next) activate(next)
    else if (beside) closeBeside()
    else activate(null)
  } else if (active === tab) activate(mainTab)
  else report()
}

/** Closed, asked first when it has changes; false when it stays. */
async function close(tab: Tab): Promise<boolean> {
  if (isDirty(tab)) {
    activate(tab)
    const choice = await folio.confirmClose(titleOf(tab))
    if (choice === 'cancel') return false
    if (choice === 'save' && !(await save(tab, false))) return false
  }
  if (tab.buffer) folio.dropBuffer(tab.buffer)
  tab.buffer = null
  remove(tab)
  return true
}

function toggleEdit(tab: Tab | null): void {
  if (!tab) return
  toggleEditTo(tab, tab.view === 'edit' ? 'read' : 'edit')
}

/** Reading or editing: drawn again where the reader was, as near as the other view allows. */
function toggleEditTo(tab: Tab, view: 'read' | 'edit'): void {
  if (tab.review) return
  if ((tab.error && !tab.buffer && tab.saved !== null) || !canEdit(formatOf(tab)) || tab.doc?.readOnly) return
  const scroller = scrollerOf(tab)
  const ratio = scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0
  tab.version = null
  tab.view = view
  render(tab)
  showBanners()
  requestAnimationFrame(() => (scroller.scrollTop = ratio * scroller.scrollHeight))
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
  if (tab.doc?.readOnly || tab.review) return false
  pull(tab)
  await formatBeforeSave(tab)
  if (tab.timer) flush(tab)
  const dir = tab.doc?.folder ?? sharedDir
  const result: SaveResult =
    tab.path === null || as || (tab.error !== null && tab.buffer !== null)
      ? await folio.saveAs(tab.text, titleOf(tab), dir)
      : await folio.save(tab.path, tab.text, tab.baseline, false)
  if ('saved' in result) {
    savedAs(tab, result)
    if (tab.path && lspByPath(tab.path)) folio.lspSave(tab.path)
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
  rail: document.querySelector<HTMLElement>('.rail-left')!,
  flyout: document.querySelector<HTMLElement>('.flyout')!,
  // Shortcut hints as the system writes them: ⌘ on a Mac, Ctrl+ elsewhere.
  // The shortcuts' key as the system writes it (strings only: the errors are a group of their own).
  text: () => Object.fromEntries(Object.entries(t.sidebar).map(([k, v]) => [k, typeof v === 'string' ? v.replace('⌘', mod) : v])) as unknown as SidebarText,
  open: (root, rel) => void folio.openEntry(root, rel).then((result) => add(result)),
  openPath: (path) => void folio.open(path).then((result) => add(result)),
  clone: () => openClone(),
  openFile: () => void openFiles(),
  newNote: () => newNote(),
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
  review: async (path, oid, after) => {
    const info = await folio.gitInfo(path)
    if (!info?.root) return
    openReview(after ? { kind: 'range', repo: info.root, from: oid, to: 'HEAD' } : { kind: 'commit', repo: info.root, oid })
  },
  open: async (path: string, v: Version) => {
    const tab = tabs.find((x) => x.path === path)
    // A picture's or a video's versions are listed; they are not text to show.
    if (tab?.doc?.media) return
    const text = await folio.gitTextAt(path, v.oid)
    if (!tab || text === null) return
    tab.version = { oid: v.oid, text, message: v.message, time: v.time, mode: tab.version?.mode ?? 'version' }
    render(tab)
    scrollerOf(tab).scrollTop = 0
  },
})
function toggleHistory(): void {
  if (!active?.path) return
  history.setVisible(!history.visible)
  prefs.set('historyOpen', history.visible)
  showBanners()
  syncRail()
}
folio.onToggleHistory(() => toggleHistory())
folio.onCommitted((value) => {
  const { path } = value as { path: string }
  reviewsSoon()
  void changesPanel?.refresh()
  void committedAgain()
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
// An agent's requests over MCP (R7): a set shown with its question, a file opened at a line.
folio.onMcpAsk((value) => {
  const { id, spec, message } = value as { id: number; spec: ChangeSpec; message: string }
  const tab = openReview(spec)
  tab.review!.agentAsks(id, message, (answer) => void folio.mcpAnswer(id, answer))
})
folio.onMcpCancel((value) => {
  for (const tab of tabs) tab.review?.agentCancelled(value as number)
})
folio.onMcpOpen((value) => {
  const { opened, line } = value as { opened: OpenResult; line: number | null }
  void add(opened).then(() => {
    const tab = active
    if (!tab || !line) return
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const editor = codeEditorOf(tab)
        if (editor) editor.goToLine(line)
        else tab.pane.querySelector<HTMLElement & { folioGoTo?: (n: number) => void }>('.code-view')?.folioGoTo?.(line)
      }),
    )
  })
})
folio.onCloseTab(() => {
  if (active) void close(active)
})
folio.onCloseAllTabs(() => void closeTabs(tabs))
folio.onAddProject(() => void sidebar.addProject())
folio.onNewNote(() => newNote())
folio.onSave(() => {
  if (active) void save(active, false)
})
folio.onSaveAs(() => {
  if (active) void save(active, true)
})
folio.onToggleEdit(() => toggleEdit(active))

// A file or folder renamed or moved in the tree: its open documents follow it.
folio.onFsMoved(async (value) => {
  const { from, to } = value as { from: string; to: string }
  for (const tab of tabs) {
    if (!tab.path || (tab.path !== from && !tab.path.startsWith(from + (folio.platform === 'win32' ? '\\' : '/')))) continue
    tab.path = to + tab.path.slice(from.length)
    const reopened = await folio.open(tab.path)
    if (isOpened(reopened)) tab.doc = reopened
    syncLabel(tab)
  }
  if (active) sidebar.setActive(active.path)
  report()
  // Links to it, in the notes of its root, follow; notes with unsaved changes are left alone.
  const skip = tabs.filter((tab) => tab.path && isDirty(tab)).map((tab) => tab.path!)
  const changed = await folio.wikiMoved(from, to, skip)
  if (changed > 0) notify(t.linksUpdated.replace('{n}', String(changed)))
})
// Put in the trash: its clean tabs close; one with unsaved changes stays, as a note to save elsewhere.
folio.onFsRemoved((value) => {
  const { path } = value as { path: string }
  const sep = folio.platform === 'win32' ? '\\' : '/'
  for (const tab of [...tabs]) {
    if (!tab.path || (tab.path !== path && !tab.path.startsWith(path + sep))) continue
    if (!isDirty(tab)) void close(tab)
  }
})

// A file changed on disk: a clean tab takes it, an edited one is told (nothing is overwritten).
folio.onFsChanged(async (value) => {
  linksSoon()
  changesSoon()
  reviewsSoon()
  const files = new Set((value as Changes[]).flatMap((c) => c.files))
  for (const tab of tabs) {
    if (!tab.path || !files.has(tab.path)) continue
    // A picture, a video or a sound changed on disk: drawn again from the new file (it is never edited here).
    if (tab.doc?.media) {
      const reopened = await folio.open(tab.path)
      if (isOpened(reopened)) {
        tab.doc = reopened
        render(tab)
      }
      continue
    }
    const disk = await folio.disk(tab.path)
    if (!disk || disk.text === tab.saved) continue
    if (isDirty(tab)) {
      if (disk.hash !== tab.baseline && disk.text !== tab.text) {
        tab.conflict = true
        if (tab === active) showBanners()
      }
      continue
    }
    const scroller = scrollerOf(tab)
    const shown = tab === mainTab || tab === beside
    const top = scroller.scrollTop
    // A log read at its end follows it: what is written appears in view.
    const follow = shown && formatOf(tab) === 'text' && top + scroller.clientHeight >= scroller.scrollHeight - 4
    tab.text = tab.saved = disk.text
    tab.baseline = disk.hash
    const reopened = await folio.open(tab.path)
    if (isOpened(reopened)) tab.doc = reopened
    if (tab.view === 'read' || formatOf(tab) !== 'markdown') render(tab)
    else (tab.pane.querySelector('dsk-markdown-editor') as (HTMLElement & { value: string }) | null)?.setAttribute('value', disk.text)
    if (shown) requestAnimationFrame(() => (scroller.scrollTop = follow ? scroller.scrollHeight : top))
  }
})

async function followWikiLink(from: string, target: string): Promise<void> {
  const result = await folio.wikiOpen(from, target)
  await add(result)
  const tab = tabs.find((t) => t.path === result.path)
  // After the frame that gives the tab back its own scroll.
  if (tab && result.heading) requestAnimationFrame(() => revealHeading(tab.pane, result.heading!, scrollerOf(tab)))
}

async function openFiles(): Promise<void> {
  for (const result of await folio.openDialog()) await add(result)
}

// Links: a document of the folder opens in a tab, the web and mail leave folio; anchors stay.
function onLinkClick(event: MouseEvent): void {
  const a = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
  // A #tag: the tags panel opens on it (in the editor, with ⌘ / Ctrl).
  const chip = (event.target as HTMLElement).closest<HTMLElement>('.uid-markdown__tag[data-tag]')
  if (chip && (!chip.closest('[contenteditable="true"]') || event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    tagsPanel?.reveal(chip.dataset.tag!)
    return
  }
  if (!a || event.defaultPrevented) return
  // `[[A note]]`: found by its name in the note's root (made when it is not there); in the editor, with ⌘ / Ctrl.
  const from = tabs.find((tab) => tab.pane.contains(a))?.path
  const editing = !!a.closest('[contenteditable="true"]')
  if (a.dataset.wikilink !== undefined && from && (!editing || event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void followWikiLink(from, a.dataset.wikilink)
    return
  }
  if (editing) return
  const href = a.href
  if (href.startsWith('folio://app/r/')) {
    event.preventDefault()
    void folio.openUrl(href).then((result) => add(result))
  } else if (/^(https?:|mailto:)/.test(href)) {
    event.preventDefault()
    folio.external(href)
  }
}
viewEl.addEventListener('click', onLinkClick)
besideEl.addEventListener('click', onLinkClick)

// A note's preview while the pointer rests on a link to it.
const preview = new HoverPreview({
  peek: (from, link) => folio.peek(from, link),
  // A link to a picture or a video: the file itself in the preview.
  draw: (note) => (note.media ? embeddedMedia(note, {}) : viewOf('markdown', note.text, { base: note.base, name: note.name })),
  reveal: (container, heading, scroller) => revealHeading(container, heading, scroller),
  open: (note) =>
    void folio.open(note.path).then(async (result) => {
      await add(result)
      const tab = tabs.find((t) => t.path === note.path)
      if (tab && note.heading) requestAnimationFrame(() => revealHeading(tab.pane, note.heading!, scrollerOf(tab)))
    }),
  fromOf: (a) => tabs.find((tab) => tab.pane.contains(a))?.path ?? null,
})
document.body.append(preview.el)
preview.attach(viewEl)
preview.attach(besideEl)
// The view scrolled: a preview shown no longer sits by its link.
viewEl.addEventListener('scroll', () => preview.hideShown(), { passive: true })
besideEl.addEventListener('scroll', () => preview.hideShown(), { passive: true })

// A click or focus in a view puts its document in use.
for (const [el, which] of [[viewEl, () => mainTab], [besideEl, () => beside]] as const) {
  const take = (): void => {
    const tab = which()
    if (tab && active !== tab) activate(tab)
  }
  el.addEventListener('pointerdown', take, true)
  el.addEventListener('focusin', take)
}

// The divider between the views: dragged, the main view's share kept for next time.
splitEl.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  splitEl.setPointerCapture(event.pointerId)
  splitEl.classList.add('dragging')
  const move = (e: PointerEvent): void => {
    const r = viewEl.getBoundingClientRect()
    const share = Math.min(0.8, Math.max(0.2, (e.clientX - r.left) / (r.width + besideEl.getBoundingClientRect().width)))
    shareViews(share)
    prefs.set('mainShare', share)
  }
  // The release counts as a move: the last moves may have been merged away.
  const up = (e: PointerEvent): void => {
    move(e)
    splitEl.classList.remove('dragging')
    splitEl.removeEventListener('pointermove', move)
    splitEl.removeEventListener('pointerup', up)
  }
  splitEl.addEventListener('pointermove', move)
  splitEl.addEventListener('pointerup', up)
})
/** The main view's share of the two, the rest beside. */
function shareViews(share: number): void {
  const box = document.querySelector<HTMLElement>('.content')!
  box.style.setProperty('--main-grow', String(share))
  box.style.setProperty('--side-grow', String(1 - share))
}
shareViews(prefs.get<number>('mainShare', 0.5))

// Dropping files on the window opens them.
viewEl.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  viewEl.classList.add('dropping')
})
viewEl.addEventListener('dragleave', () => viewEl.classList.remove('dropping'))
// Seen first: a picture dropped into the editor is taken there and goes no further.
viewEl.addEventListener('drop', () => viewEl.classList.remove('dropping'), true)
viewEl.addEventListener('drop', async (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  viewEl.classList.remove('dropping')
  for (const file of Array.from(event.dataTransfer.files)) {
    const path = folio.pathOf(file)
    if (path) await add(await folio.open(path))
  }
})

// Finding --------------------------------------------------------------------------

/** One field target per text field: it frames its match and follows the field's scroll. */
const fieldTargets = new WeakMap<HTMLTextAreaElement, FindTarget>()
const editorTargets = new WeakMap<CodeEditor, FindTarget>()

/** What the bar searches: a view's own target, the field being edited, or the page as drawn. */
function findTarget(): Retarget {
  const inConsole = consolePanel.findTarget()
  if (inConsole) return { target: inConsole, own: true, onClose: () => consolePanel.focusActive() }
  const tab = active
  if (!tab) return { target: null }
  const code = tab.pane.querySelector<WithFindTarget>('.code-view')
  if (code?.folioFind) return { target: code.folioFind, own: true }
  const editor = codeEditorOf(tab)
  if (editor) {
    let target = editorTargets.get(editor)
    if (!target) editorTargets.set(editor, (target = editorTarget(editor)))
    return { target, own: true, onClose: () => editor.focus() }
  }
  const area = [...tab.pane.querySelectorAll('textarea')].find((a) => a.checkVisibility())
  if (area) {
    let target = fieldTargets.get(area)
    if (!target) fieldTargets.set(area, (target = fieldTarget(area)))
    return { target, onClose: (pattern, index) => selectInField(area, pattern, index) }
  }
  return { target: domTarget(tab.pane, '.doc-toolbar') }
}

const findBar = new FindBar(t.find, findTarget, viewEl)
symbolPalette = new SymbolPalette(t.symbols)
document.body.append(symbolPalette.el)

/** The find bar, the code editor's selected text (one line) as its query. */
function openFind(): void {
  const editor = codeEditorOf(active)
  const main = editor?.state.selection.main
  const text = editor && main && !main.empty ? editor.state.doc.slice(main.from, main.to) : undefined
  findBar.open(text)
}
document.querySelector('.content')!.append(findBar.el)
const goToFile = new GoToFile(t.goToFile, () => folio.allFiles(), (f) => void folio.openEntry(f.root, f.path).then((result) => add(result)))
document.body.append(goToFile.el)

/**
 * Two files compared: `other` (chosen first, or in the picker) against
 * `path`, in `path`'s tab — the history's view of a version: the changes, side
 * by side, or the other file as drawn; its text taken into the editor on asking.
 */
async function compareFiles(other: string, path: string): Promise<void> {
  const [a, b] = await Promise.all([folio.open(other), folio.open(path)])
  if (!isOpened(a) || !isOpened(b) || a.media || b.media) {
    notify(t.cannotCompare)
    return
  }
  await add(b)
  const tab = tabs.find((x) => x.path === b.path)
  if (!tab) return
  tab.version = { oid: '', text: a.text, message: '', time: 0, mode: 'diff', compare: a.name }
  render(tab)
  scrollerOf(tab).scrollTop = 0
}
folio.onCompareFiles((value) => {
  const { a, b } = value as { a: string; b: string }
  void compareFiles(a, b)
})
/** The file in view compared with one chosen like going to a file. */
function compareWithChosen(): void {
  const path = active?.path
  if (!path) return
  void goToFile.open((f) => void folio.openEntry(f.root, f.path).then((r) => (isOpened(r) ? compareFiles(r.path, path) : undefined)))
}
folio.onGoToFile(() => void goToFile.open())

// Daily notes and templates ----------------------------------------------------------------

/** Whether a file is among the bookmarks (as the sidebar last showed them). */
let bookmarkPaths = new Set<string>()
folio.onWorkspace((value) => (bookmarkPaths = new Set((value as WorkspaceView).bookmarks.map((b) => b.path))))
void folio.workspace().then((ws) => (bookmarkPaths = new Set(ws.bookmarks.map((b) => b.path))))
const bookmarked = (path: string): boolean => bookmarkPaths.has(path)

const isDaily = (): boolean => !!active?.path && /(^|[\\/])\d{4}-\d{2}-\d{2}\.md$/.test(active.path)

/** A new kanban board, calendar or whiteboard beside the note in view, opened for editing. */
async function newKind(kind: 'kanban' | 'calendar' | 'board'): Promise<void> {
  const result = await folio.newKind(kind, active?.path ?? null)
  await add(result)
  const tab = tabs.find((t) => t.path === result.path)
  if (tab && isOpened(result)) setMode(tab, 'visual')
}

/** Today's daily note, or the one before / after the open one's day. */
async function openDaily(step: 0 | -1 | 1): Promise<void> {
  const result = await folio.dailyOpen(isDaily() ? active!.path : null, step)
  if ('error' in result && result.error === 'none') return notify(t.commands.noDaily)
  await add(result)
}

/** A template chosen in the palette; none there — the folder named. */
async function chooseTemplate(use: (path: string) => void): Promise<void> {
  const list = await folio.templates()
  if (list.length === 0) return notify(t.commands.noTemplates.replace('{folder}', (await folio.folders()).templates))
  palette.pick(list.map((tpl) => ({ id: `template:${tpl.path}`, group: t.commands.notes, title: tpl.name, icon: 'note', run: () => use(tpl.path) })), t.commands.chooseTemplate)
}

/** A template at the caret of the note in view, its title the note's name; read mode switches to editing. */
async function insertTemplate(path: string): Promise<void> {
  const tab = active
  if (!tab) return
  const title = (tab.path ?? '').split(/[\\/]/).pop()?.replace(/\.(md|markdown)$/i, '') ?? ''
  const text = await folio.fillTemplate(path, title)
  if (text === null) return
  if (tab.view !== 'edit') toggleEditTo(tab, 'edit')
  const ed = tab.pane.querySelector<HTMLElement & { insert(text: string): unknown }>('dsk-markdown-editor')
  await ed?.insert(text)
}

/** A quick note from a template: not a file until it is saved. */
async function noteFromTemplate(path: string): Promise<void> {
  const text = await folio.fillTemplate(path, '')
  if (text === null) return
  const tab = makeTab({ path: null, text, saved: null, view: 'edit' })
  activate(tab)
  edited(tab)
}

/** Every action by its name: what the menus and the rails do, offered when it can run. */
function commands(): Command[] {
  const c = t.commands
  const has = (): boolean => active !== null
  /** A document with text (not a picture, a video or a sound): printed, exported, searched in. */
  const hasText = (): boolean => active !== null && !active.doc?.media
  const file = c.file
  const view = c.view
  const list: Command[] = [
    { id: 'new-note', group: file, title: c.newNote, keys: `${mod}N`, icon: 'note', run: () => newNote() },
    { id: 'open', group: file, title: t.open, keys: `${mod}O`, icon: 'open', run: () => void folio.openDialog().then(async (docs) => { for (const d of docs) await add(d) }) },
    { id: 'go-to-file', group: file, title: c.goToFile, keys: `${mod}T`, icon: 'file', run: () => void goToFile.open() },
    { id: 'add-project', group: file, title: c.addProject, icon: 'folderPlus', run: () => void sidebar.addProject() },
    { id: 'reveal', group: file, title: t.tabMenu.reveal, icon: 'folder', when: () => !!active?.path, run: () => active?.path && void sidebar.reveal(active.path) },
    { id: 'clone', group: file, title: c.clone, icon: 'clone', run: () => openClone() },
    { id: 'save', group: file, title: c.save, keys: `${mod}S`, icon: 'save', when: has, run: () => active && void save(active, false) },
    { id: 'save-as', group: file, title: c.saveAs, keys: `${mod}⇧S`, icon: 'save', when: has, run: () => active && void save(active, true) },
    { id: 'print', group: file, title: t.print, keys: `${mod}P`, icon: 'print', when: hasText, run: () => void printActive() },
    { id: 'export-pdf', group: file, title: t.exportPdf, keys: `${mod}⇧P`, icon: 'pdf', when: hasText, run: () => exportActive() },
    { id: 'export-html', group: file, title: t.exportHtml, icon: 'file', when: hasText, run: () => void exportAs('html') },
    { id: 'export-docx', group: file, title: t.exportDocx, icon: 'file', when: hasText, run: () => void exportAs('docx') },
    { id: 'present', group: view, title: c.present, keys: 'F5', icon: 'present', when: isNote, run: () => present() },
    { id: 'export-slides', group: file, title: c.slidesPdf, icon: 'pdf', when: isNote, run: () => void exportSlides() },
    { id: 'close-tab', group: file, title: c.closeTab, keys: `${mod}W`, icon: 'close', when: has, run: () => active && void close(active) },
    { id: 'reopen-tab', group: file, title: c.reopenTab, keys: `${mod}⇧T`, icon: 'undo', when: () => closedTabs.length > 0, run: () => void reopenClosed() },
    { id: 'close-all-tabs', group: file, title: c.closeAllTabs, keys: `${mod}⇧W`, icon: 'close', when: has, run: () => void closeTabs(tabs) },
    { id: 'close-other-tabs', group: file, title: c.closeOtherTabs, icon: 'close', when: () => tabs.length > 1 && !!active, run: () => void closeTabs(tabs.filter((x) => x !== active)) },
    { id: 'close-saved-tabs', group: file, title: c.closeSavedTabs, icon: 'close', when: () => tabs.some((x) => !isDirty(x)), run: () => void closeTabs(tabs.filter((x) => !isDirty(x))) },
    { id: 'daily', group: c.notes, title: c.daily, keys: `${mod}⇧D`, icon: 'calendar', run: () => void openDaily(0) },
    { id: 'daily-prev', group: c.notes, title: c.dailyPrev, icon: 'calendar', when: isDaily, run: () => void openDaily(-1) },
    { id: 'daily-next', group: c.notes, title: c.dailyNext, icon: 'calendar', when: isDaily, run: () => void openDaily(1) },
    { id: 'new-kanban', group: c.notes, title: c.newKanban, icon: 'tasks', run: () => void newKind('kanban') },
    { id: 'new-calendar', group: c.notes, title: c.newCalendar, icon: 'calendar', run: () => void newKind('calendar') },
    { id: 'new-canvas', group: c.notes, title: c.newCanvas, icon: 'diagram', run: () => void newKind('board') },
    { id: 'bookmark', group: c.notes, title: c.bookmark, icon: 'star', when: () => !!active?.path && !bookmarked(active.path), run: () => void folio.bookmark(active!.path!, true) },
    { id: 'unbookmark', group: c.notes, title: c.unbookmark, icon: 'star', when: () => !!active?.path && bookmarked(active.path), run: () => void folio.bookmark(active!.path!, false) },
    { id: 'template-insert', group: c.notes, title: c.insertTemplate, icon: 'note', when: () => !!active && formatOf(active) === 'markdown' && !active.version, run: () => void chooseTemplate((path) => void insertTemplate(path)) },
    { id: 'template-new', group: c.notes, title: c.newFromTemplate, icon: 'note', run: () => void chooseTemplate((path) => void noteFromTemplate(path)) },
    { id: 'find', group: c.edit, title: c.find, keys: `${mod}F`, icon: 'search', when: hasText, run: () => openFind() },
    { id: 'compare-with', group: file, title: t.compareWithCommand, icon: 'split', when: () => !!active?.path && !active.doc?.media, run: () => compareWithChosen() },
    { id: 'welcome', group: view, title: t.welcomeDoc, icon: 'read', run: () => void openWelcome() },
    { id: 'settings', group: view, title: t.settingsWindow.title, keys: `${mod},`, icon: 'settings', run: () => void settingsDialog.open() },
    { id: 'processes', group: view, title: t.resources.title, icon: 'activity', run: () => void resources?.open() },
    { id: 'keep-awake', group: view, title: t.awake.title, icon: 'awake', run: () => awakeButton?.menu() },
    { id: 'toggle-wrap', group: view, title: t.wrapLines, keys: '⌥Z', icon: 'source', when: () => !!codeEditorOf(active), run: () => toggleWrap() },
    { id: 'go-to-line', group: c.edit, title: c.goToLine, keys: 'Ctrl+G', icon: 'search', when: () => !!codeEditorOf(active), run: () => codeEditorOf(active)?.openGoToLine() },
    { id: 'symbol-file', group: c.edit, title: t.symbols.file, keys: `${mod}⇧O`, icon: 'outline', when: () => !!navOf(active), run: () => goToSymbol('file') },
    { id: 'symbol-project', group: c.edit, title: t.symbols.project, keys: `${mod}⌥O`, icon: 'search', run: () => goToSymbol('project') },
    { id: 'task-run', group: c.edit, title: t.tasks2.run, keys: `${mod}⇧B`, icon: 'play', run: () => void chooseTask() },
    { id: 'lsp-log', group: view, title: t.lsp.log, icon: 'console', when: () => !!lspOf(active), run: () => void showLspLog() },
    { id: 'problems', group: view, title: t.problems.title, icon: 'alert', run: () => problemsPanel?.setVisible(!problemsPanel.visible) },
    { id: 'find-in-files', group: c.edit, title: c.findInFiles, keys: `${mod}⇧F`, icon: 'search', run: () => void searchPanel.open() },
    ...MODES.map(([m, name]): Command => ({ id: `mode-${m}`, group: view, title: t.modeNames[m], icon: name, when: () => modesOf(active).has(m) && modeOf(active!) !== m, run: () => setMode(active, m) })),
    { id: 'beside', group: view, title: t.openBeside, keys: `${mod}\\`, icon: 'panelRight', when: () => !!active && active !== beside && tabs.length > 1, run: () => active && openBeside(active) },
    { id: 'back-to-main', group: view, title: t.backToMain, keys: `${mod}\\`, icon: 'panelRight', when: () => beside !== null, run: () => closeBeside() },
    { id: 'sidebar', group: view, title: c.sidebar, keys: `${mod}B`, icon: 'collapse', run: () => sidebar.toggleCollapsed() },
    { id: 'console', group: view, title: t.console.title, keys: 'Ctrl+`', icon: 'console', run: () => consolePanel.toggle(null) },
    { id: 'history', group: view, title: t.history, keys: `${mod}⇧H`, icon: 'history', when: () => !!active?.path, run: () => toggleHistory() },
    { id: 'outline', group: view, title: t.outline.title, icon: 'outline', run: () => outlinePanel?.setVisible(!outlinePanel.visible) },
    { id: 'links', group: view, title: t.links.title, icon: 'links', run: () => linksPanel?.setVisible(!linksPanel.visible) },
    { id: 'tags', group: view, title: t.tags.title, icon: 'tag', run: () => tagsPanel?.setVisible(!tagsPanel.visible) },
    { id: 'tasks', group: view, title: t.tasks.title, icon: 'tasks', run: () => tasksPanel?.setVisible(!tasksPanel.visible) },
    { id: 'blame', group: view, title: t.blame, icon: 'history', when: () => !!codeEditorOf(active), run: () => void toggleBlame() },
    { id: 'changes', group: view, title: t.changes.title, keys: 'Ctrl+⇧G', icon: 'commit', run: () => changesPanel?.setVisible(!changesPanel.visible) },
    { id: 'claude-connect', group: view, title: c.claudeConnect, icon: 'links', run: () => void claudeConnect(true) },
    { id: 'claude-disconnect', group: view, title: c.claudeDisconnect, icon: 'links', run: () => void claudeConnect(false) },
    { id: 'worktrees', group: view, title: c.worktrees, icon: 'branch', run: () => worktreesPanel?.setVisible(!worktreesPanel.visible) },
    { id: 'review-changes', group: view, title: c.reviewChanges, icon: 'commit', run: () => void reviewWorking() },
    {
      id: 'review-since',
      group: view,
      title: c.reviewSince,
      icon: 'commit',
      run: () => void repoInView().then((repo) => repo && void openReview({ kind: 'since', repo })),
    },
    { id: 'graph', group: view, title: t.graph.title, icon: 'graph', run: () => graphPanel?.setVisible(!graphPanel.visible) },
    ...(['system', 'light', 'dark'] as const).map((value): Command => ({ id: `theme-${value}`, group: view, title: t.themes[value], icon: 'settings', when: () => theme !== value, run: () => applyTheme(value) })),
  ]
  return list
}
const palette = new CommandPalette(t.commands, commands)
document.body.append(palette.el)
folio.onPalette(() => palette.open())

const searchPanel = new SearchPanel(
  t.search,
  { scopes: () => folio.searchScopes(), run: (id, q, o, scope) => folio.search(id, q, { ...o }, scope), cancel: () => folio.cancelSearch(), onHits: (cb) => void folio.onSearchHits(cb), replace: (q, o, r, files) => folio.replace(q, { ...o }, r, files), isDirty: (file) => tabs.some((tab) => tab.path === file && isDirty(tab)) },
  // The file opened, the find bar landing on the match: the same query, the match's place among the file's.
  (file, index, query, options) =>
    void folio.openEntry(file.root, file.path).then(async (result) => {
      await add(result)
      // After the tab's own scroll comes back (the next frame): then to the match.
      if (query) requestAnimationFrame(() => requestAnimationFrame(() => findBar.openWith(query, options, index)))
    }),
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(searchPanel.el, document.querySelector('.history'))

linksPanel = new LinksPanel(
  t.links,
  { panel: (note, text) => folio.wikiPanel(note, text), linkMention: (file, index, length, link) => folio.linkMention(file, index, length, link), isDirty: (file) => tabs.some((tab) => tab.path === file && isDirty(tab)) },
  {
    openAt: (path, place) =>
      void folio.open(path).then(async (result) => {
        await add(result)
        if (place.display) requestAnimationFrame(() => requestAnimationFrame(() => findBar.openWith(place.display, { caseSensitive: false, wholeWord: false, regex: false }, place.nth)))
      }),
    follow: (from, raw) => void followWikiLink(from, raw),
  },
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(linksPanel.el, document.querySelector('.history'))

tagsPanel = new TagsPanel(
  t.tags,
  (note) => folio.tagIndex(note),
  (path) => void folio.open(path).then((result) => add(result)),
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(tagsPanel.el, document.querySelector('.history'))
tagsPanel.show(null)

graphPanel = new GraphPanel(
  t.graph,
  (note) => folio.graph(note),
  (path) => void folio.open(path).then((result) => add(result)),
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(graphPanel.el, document.querySelector('.history'))
graphPanel.show(null)

problemsPanel = new ProblemsPanel(
  t.problems,
  (p) => p.path && void openInEditor(p.path, p.line, p.column),
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(problemsPanel.el, document.querySelector('.history'))

/** A git refusal in words (null: done). */
function refusalOf(r: { ok: boolean } | GitRefusal): string | null {
  return 'error' in r ? describeRefusal(t.historyPanel.errors, r) : null
}

changesPanel = new ChangesPanel(
  t.changes,
  {
    load: (path) => (path ? folio.gitChanges(path) : Promise.resolve(null)),
    stage: async (root, paths) => void (await folio.gitStage(root, paths)),
    unstage: async (root, paths) => void (await folio.gitUnstage(root, paths)),
    discard: (root, path) => folio.gitDiscard(root, path),
    commit: (root, message, amend) => folio.gitCommitStaged(root, message, amend),
    open: (root, path) => void folio.open(`${root}/${path}`).then((result) => add(result)),
    review: (root) => void openReview({ kind: 'working', repo: root }),
    sinceCount: async (root) => {
      const r = await folio.reviewSinceCount(root)
      return 'ok' in r ? r.count : null
    },
    reviewSince: (root) => void openReview({ kind: 'since', repo: root }),
    lastMessage: (root) => folio.gitLastMessage(root),
    stashes: async (root) => {
      const r = await folio.gitStashList(root)
      return 'list' in r ? r.list : []
    },
    stash: async (root, message) => refusalOf(await folio.gitStashPush(root, message)),
    applyStash: async (root, index, pop) => refusalOf(await folio.gitStashApply(root, index, pop)),
    dropStash: async (root, index) => refusalOf(await folio.gitStashDrop(root, index)),
  },
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(changesPanel.el, document.querySelector('.history'))
changesPanel.show(null)

const failed = (r: { ok?: unknown } | GitRefusal): GitRefusal | null => ('error' in r ? (r as GitRefusal) : null)
worktreesPanel = new WorktreesPanel(
  t.worktrees,
  {
    load: (path, base) => folio.reviewWorktrees(path, base),
    branches: async (path) => (await folio.gitInfo(path))?.branches ?? [],
    review: (spec) => void openReview(spec),
    project: async (main, path) => {
      const r = await folio.reviewWorktreeProject(main, path)
      if ('ok' in r) sidebar.show(r.workspace)
      return failed(r)
    },
    console: (path) => void consolePanel.open(path),
    merge: async (main, branch) => failed(await folio.reviewWorktreeMerge(main, branch)),
    take: async (main, path, base) => failed(await folio.reviewWorktreeTake(main, path, base)),
    edits: async (main) => {
      const r = await folio.reviewAgentEdits(main)
      return 'ok' in r ? r.edits : []
    },
    remove: async (main, w) => {
      const r = await folio.reviewWorktreeRemove(main, w.path, w.branch, w.changed)
      if ('workspace' in r && r.workspace) sidebar.show(r.workspace)
      return failed(r)
    },
    errors: () => t.historyPanel.errors,
    lang: () => lang,
  },
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(worktreesPanel.el, document.querySelector('.history'))
worktreesPanel.show(null)

tasksPanel = new TasksPanel(
  t.tasks,
  {
    load: (note) => folio.tasks(note),
    toggle: (task, done) => folio.toggleTask(task.path, task.line, task.raw, done),
    isDirty: (path) => tabs.some((tab) => tab.path === path && isDirty(tab)),
    open: (task) =>
      void folio.open(task.path).then(async (result) => {
        await add(result)
        requestAnimationFrame(() => requestAnimationFrame(() => findBar.openWith(task.text, { caseSensitive: true, wholeWord: false, regex: false }, 0)))
      }),
  },
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(tasksPanel.el, document.querySelector('.history'))
tasksPanel.show(null)

outlinePanel = new OutlinePanel(t.outline, { go: (h, i) => goToHeading(h, i) }, (on) => {
  syncRail()
  if (on) syncOutline()
})
document.querySelector('.content')!.insertBefore(outlinePanel.el, document.querySelector('.history'))
for (const view of [viewEl, besideEl]) {
  let pending = false
  view.addEventListener('scroll', () => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      markSection()
    })
  }, { passive: true })
}

statusBar = new StatusBar(document.querySelector<HTMLElement>('.status')!, t.status)
// The caret moved in a source field: its line and column.
document.addEventListener('selectionchange', () => {
  if (document.activeElement instanceof HTMLTextAreaElement) syncStatus()
})
document.addEventListener('focusin', () => syncStatus())
// The code editor's caret moved.
document.addEventListener('dsk:selection', () => syncStatus())
void folio.spellcheck().then((on) => (spellOn = on))

// Updates: where a check is; what it found is said when it was asked for, or when a version is ready.
let update: { state: UpdateState; auto: boolean; current: string; checkable: boolean } = { state: { status: 'idle' }, auto: true, current: '', checkable: false }
let askedForUpdate = false
void folio.updateState().then((u) => {
  update = u
  if (u.state.status === 'ready') notify(t.update.ready.replace('{v}', u.state.version))
})
function sayUpdate(state: UpdateState): void {
  update.state = state
  const v = 'version' in state ? state.version : update.current
  if (state.status === 'ready') notify(t.update.ready.replace('{v}', v))
  else if (!askedForUpdate) return
  else if (state.status === 'downloading') notify(t.update.downloading.replace('{v}', v) + downloadProgress(state))
  else if (state.status === 'latest') notify(t.update.latest.replace('{v}', v))
  else if (state.status === 'error') notify(t.update.failed.replace('{error}', state.error))
  if (state.status !== 'checking' && state.status !== 'downloading') askedForUpdate = false
}
/** How far a download is: a percent and megabytes, or the megabytes alone when the size is not known. */
function downloadProgress(state: Extract<UpdateState, { status: 'downloading' }>): string {
  if (state.received === undefined) return ''
  const mb = (n: number) => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)
  if (!state.total) return ` ${mb(state.received)} ${t.update.mb}`
  return ` ${Math.min(100, Math.floor((state.received / state.total) * 100))}% · ${mb(state.received)} / ${mb(state.total)} ${t.update.mb}`
}
folio.onUpdate((state) => sayUpdate(state as UpdateState))
function checkUpdate(): void {
  if (!update.checkable) return notify(t.update.source)
  askedForUpdate = true
  notify(t.update.checking)
  void folio.checkUpdate()
}
linksPanel.show(noteOf(active))

/** The consoles' words, with the tab menu's for their tabs' colours and groups. */
const consoleText = () => ({ ...t.console, tabMenu: t.tabMenu })
const consolePanel = new ConsolePanel(
  consoleText(),
  {
    open: (cwd, cols, rows, command) => folio.openConsole(cwd, cols, rows, command),
    input: (id, data) => folio.consoleInput(id, data),
    resize: (id, cols, rows) => folio.consoleResize(id, cols, rows),
    close: (id) => folio.closeConsole(id),
    onData: (cb) => void folio.onConsoleData(cb),
    onExit: (cb) => void folio.onConsoleExit(cb),
    external: (url) => folio.external(url),
    resolve: (cwd, text) => folio.resolveConsolePath(cwd, text),
    openFile: (path, line) => void openAt(path, line),
    pathOf: (file) => folio.pathOf(file),
    platform: folio.platform,
    find: () => openFind(),
  },
  () => syncRail(),
)

/** A file opened (or brought to front) at a line: a code view scrolls to it. */
async function openAt(path: string, line: number | null): Promise<void> {
  await add(await folio.open(path))
  if (!line) return
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const code = active?.pane.querySelector<HTMLElement & { folioGoTo?: (n: number) => void }>('.code-view')
      code?.folioGoTo?.(line)
    }),
  )
}
document.querySelector('.main')!.append(consolePanel.el)
// The consoles follow the window's theme.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const consoleTheme = (): void => consolePanel.setDark(theme === 'dark' || (theme === 'system' && darkQuery.matches))
darkQuery.addEventListener('change', consoleTheme)
folio.onToggleConsole(() => consolePanel.toggle(null))
folio.onConsoleHere((path) => void consolePanel.open(path as string))

folio.onFind((what) => (what === 'next' ? findBar.step(1) : what === 'previous' ? findBar.step(-1) : what === 'files' ? void searchPanel.open() : openFind()))

// Shortcuts: the window handles them (the menus only show them), the same on every system.
window.addEventListener(
  'keydown',
  (event) => {
    // Keys of one's own come first: the editor's in the editor (it handles them), then folio's.
    if (editorKeys.size && (event.target as Element | null)?.closest?.('.dsk-code-editor') && editorKeys.has(keyName(event))) return
    if (folioKey(event)) return
    // Ctrl+` on every system: the consoles.
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote') {
      event.preventDefault()
      event.stopPropagation()
      consolePanel.toggle(null)
      return
    }
    // Ctrl with a letter in a console is the shell's (^W, ^E, ^P…), not folio's: off a Mac the shortcuts stay out.
    // Except Ctrl+F: the find bar over the output (as in VS Code's terminal).
    if (folio.platform !== 'darwin' && (event.target as HTMLElement | null)?.closest?.('.dsk-term') && !(event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f')) return
    // Alt+Z, as in VS Code: long lines wrapped or not.
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyZ' && codeEditorOf(active)) {
      event.preventDefault()
      event.stopPropagation()
      toggleWrap()
      return
    }
    // F1, as in code editors: the commands.
    if (event.key === 'F1' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault()
      palette.open()
      return
    }
    // F5, as in presentation programs: the note as slides.
    if (event.key === 'F5' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && isNote()) {
      event.preventDefault()
      present()
      return
    }
    // Ctrl+Shift+G on every system, as in VS Code: the changes (source control).
    if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && event.code === 'KeyG') {
      event.preventDefault()
      event.stopPropagation()
      changesPanel?.setVisible(!changesPanel.visible)
      return
    }
    // Cmd/Ctrl+Shift+B: a task of the project (VS Code's build task).
    if ((folio.platform === 'darwin' ? event.metaKey : event.ctrlKey) && event.shiftKey && !event.altKey && event.code === 'KeyB') {
      event.preventDefault()
      event.stopPropagation()
      void chooseTask()
      return
    }
    // Cmd/Ctrl+Shift+O: a symbol of the file; Cmd/Ctrl+Alt+O: of the projects (as in VS Code).
    const modKey = folio.platform === 'darwin' ? event.metaKey : event.ctrlKey
    if (modKey && event.code === 'KeyO' && (event.shiftKey || event.altKey) && !(event.shiftKey && event.altKey)) {
      event.preventDefault()
      event.stopPropagation()
      goToSymbol(event.shiftKey ? 'file' : 'project')
      return
    }
    // F3 off a Mac, as in VS Code: the next match (Shift: the previous).
    if (event.key === 'F3' && folio.platform !== 'darwin' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      findBar.step(event.shiftKey ? -1 : 1)
      return
    }
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
      // Cmd/Ctrl+W the tab; with Shift, every tab.
      w: () => {
        if (event.shiftKey) void closeTabs(tabs)
        else if (active) void close(active)
      },
      e: () => toggleEdit(active),
      p: () => (event.shiftKey ? exportActive() : void printActive()),
      h: () => {
        if (event.shiftKey) toggleHistory()
      },
      b: () => sidebar.toggleCollapsed(),
      f: () => (event.shiftKey ? void searchPanel.open() : openFind()),
      // Cmd/Ctrl+T: go to a file; with Shift, as in browsers: the tab just closed.
      t: () => (event.shiftKey ? void reopenClosed() : void goToFile.open()),
      k: () => palette.open(),
      // Cmd/Ctrl+, as in every app: the settings.
      ',': () => void settingsDialog.open(),
      d: () => {
        if (event.shiftKey) void openDaily(0)
      },
      // The active document beside the main view, or the side view closed.
      '\\': () => (beside ? closeBeside() : active && openBeside(active)),
      // Cmd+G on macOS; elsewhere Ctrl+G is the editor's (go to line) and F3 finds the next match.
      ...(folio.platform === 'darwin' ? { g: () => findBar.step(event.shiftKey ? -1 : 1) } : {}),
    }
    const fn = act[key]
    if (!fn || (key !== 's' && key !== 'h' && key !== 'p' && key !== 'g' && key !== 'f' && key !== 'd' && key !== 't' && key !== 'w' && event.shiftKey) || ((key === 'h' || key === 'd') && !event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    fn()
  },
  true,
)

// Printing ----------------------------------------------------------------------------

/**
 * The active document on paper: read, not edited; every widget in its print
 * form (embed's `print.prepare`) — the whole diagram, every page, a reference
 * as its static view; folio's own chrome stays off paper (style.css).
 */
async function printActive(): Promise<void> {
  const tab = active
  if (!tab || tab.doc?.media) return
  if (tab.view === 'edit' && canEdit(formatOf(tab))) toggleEdit(tab)
  // Paper is light: the widgets too, for the time of printing.
  window.DskEmbed?.configure({ theme: 'light' })
  // It waits for the widgets still drawing (a document just switched to reading), then makes the forms.
  const restore = (await window.DskEmbed?.print?.prepare(tab.pane)) ?? (() => {})
  document.body.dataset.printing = ''
  tab.pane.dataset.printing = ''
  try {
    window.print()
  } finally {
    delete document.body.dataset.printing
    delete tab.pane.dataset.printing
    restore()
    window.DskEmbed?.configure({ theme })
  }
}
folio.onPrint(() => void printActive())

// Export as PDF: the active document as shown (unsaved edits too), a file or a folder from the tree.
function exportPdf(target: PdfTarget): void {
  openPdfDialog(t.pdf, target, notify)
}
/** The document in view as one HTML page or a Word file: drawn out of sight as when read, then saved where asked. */
async function exportAs(kind: 'html' | 'docx'): Promise<void> {
  const tab = active
  if (!tab || tab.doc?.media) return
  const name = titleOf(tab)
  notify(t.exporting)
  const page = await drawn(viewOf(formatOf(tab), tab.text, { ...viewOptions(tab), main: false }), theme)
  let payload: unknown
  try {
    payload = kind === 'html' ? await toHtml(page.root, name.replace(/\.[^.]+$/, ''), lang) : await toDocx(page.root, name.replace(/\.[^.]+$/, ''))
  } finally {
    page.done()
  }
  const result = await folio.exportFile(kind, name, payload)
  if ('canceled' in result) noticeEl.hidden = true
  else notify('saved' in result ? t.pdf.saved.replace('{file}', result.saved) : t.pdf.failed.replace('{error}', result.error))
}

function exportActive(): void {
  if (!active || active.doc?.media) return
  exportPdf({ kind: 'doc', path: active.path, text: active.text, name: titleOf(active) })
}
folio.onExportPdf(() => exportActive())

// Presenting: the active note as slides, over the whole screen; its slides as a PDF, one to a page.
const isNote = (): boolean => !!active && formatOf(active) === 'markdown'
let showing: Presentation | null = null
function present(): void {
  if (!active || showing) return
  const tab = active
  const slides = slidesOf(tab.text)
  if (slides.length === 0) return
  showing = new Presentation(
    t.slides,
    slides,
    (slide) => viewOf('markdown', slide, viewOptions(tab)),
    () => void exportSlides(tab),
    () => (showing = null),
  )
  showing.open()
}
async function exportSlides(tab = active): Promise<void> {
  if (!tab) return
  const result = await folio.exportPdf({ kind: 'doc', path: tab.path, text: tab.text, name: titleOf(tab), slides: true }, {})
  if ('canceled' in result) return
  notify('saved' in result ? t.pdf.saved.replace('{file}', result.saved) : t.pdf.failed.replace('{error}', result.error))
}
folio.onExportFile((value) => exportPdf({ kind: 'doc', path: value as string }))
folio.onExportFolder((value) => exportPdf({ kind: 'folder', dir: value as string }))

// Going away: what is still settling is written now.
window.addEventListener('beforeunload', () => {
  for (const tab of tabs) if (tab.timer) flush(tab)
})

// The sidebar: collapsed to its rail with Cmd/Ctrl+B, its width dragged and remembered.
document.documentElement.style.setProperty('--sidebar-width', `${prefs.get('sidebarWidth', 260)}px`)
folio.onToggleSidebar(() => sidebar.toggleCollapsed())
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
/** The welcome document (ADR-005): what folio can do, in the language in use, read-only. */
async function openWelcome(): Promise<void> {
  await add(await folio.openWelcome())
}
folio.onWelcome(() => void openWelcome())
welcomeEl.querySelector('[data-testid="welcome-open"]')?.addEventListener('click', () => void openWelcome())

/** The languages there are and the one chosen (null: the system's), for the settings menu. */
let i18n: I18nState | null = null

/**
 * The window in a language (ADR-005): its words, the code view's, the widgets'
 * (embed takes the code; what it does not know is English), every panel's
 * and the documents drawn again.
 */
function applyI18n(state: I18nState, redraw = false): void {
  i18n = state
  lang = state.code
  t = state.window as WindowText
  setCodeWords(t.codeView)
  document.documentElement.lang = lang
  applyText()
  window.DskEmbed?.configure({ locale: lang })
  if (!redraw) return
  buildRail()
  // The sidebar takes its words as it draws: drawn again.
  void sidebar.load()
  for (const tab of tabs) {
    tab.review?.applyText()
    syncLabel(tab)
    render(tab)
  }
  syncStatus()
  report()
  // The welcome page open: the one of the new language, at its place.
  void (async () => {
    for (const tab of tabs.filter((x) => x.doc?.readOnly)) {
      const next = await folio.openWelcome()
      if (!isOpened(next) || next.path === tab.path) continue
      const index = tabs.indexOf(tab)
      const wasActive = tab === active
      remove(tab)
      closedTabs.shift()
      await add(next, wasActive)
      const added = tabs.find((x) => x.path === next.path)
      if (added) grouped.move(added, index)
    }
  })()
}
folio.onI18nChanged((state) => applyI18n(state as I18nState, true))

void folio.startup().then(async ({ tabs: restored, groups: savedGroups, active: activeIndex, shared, i18n: state, welcome }) => {
  sharedDir = shared
  history.setVisible(prefs.get('historyOpen', false))
  applyI18n(state)
  applyTheme(theme)
  buildRail()
  // The run before ended without quitting (ADR-008): said once, with the log at hand.
  void folio.lastRun().then((r) => {
    if (r.ended !== 'crashed') return
    const time = r.at ? new Date(r.at).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }) : '—'
    resources?.toast(t.resources.crashed.replace('{time}', time), [
      [t.resources.openLog, () => void folio.openLog()],
      [t.resources.report, () => void folio.saveReport().then((path) => path && notify(t.resources.reportSaved.replace('{path}', path)))],
    ])
  })
  void sidebar.load()
  for (const g of savedGroups ?? []) grouped.restore(g)
  for (const r of restored) {
    const doc = isOpened(r.doc) ? r.doc : null
    const b = r.buffer
    const look = { color: isTabColor(r.color) ? r.color : null, group: typeof r.group === 'string' && grouped.groups.has(r.group) ? r.group : null }
    if (r.review) {
      openReview(r.review, false, look)
      continue
    }
    if (b) {
      makeTab({
        ...look,
        path: b.path,
        doc,
        error: r.doc && 'error' in r.doc ? r.doc.error : null,
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
    } else if (r.doc) await add(r.doc, false, look)
  }
  grouped.layout()
  for (const tab of tabs) syncLabel(tab)
  activate(tabs[activeIndex ?? -1] ?? tabs[tabs.length - 1] ?? null)
  // The first start: what folio can do, in the language in use.
  if (welcome && tabs.length === 0) await openWelcome()
}).catch(startupFailed)
