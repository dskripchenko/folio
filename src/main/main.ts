import { app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, session as electronSession, shell, systemPreferences } from 'electron'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { userInfo } from 'node:os'
import { AutoCommitter } from './autoCommit'
import { changesOf, commitStaged, discardFile, stageFiles, unstageFiles } from './changes'
import { blameOf } from './blame'
import { tasksOf as projectTasksOf } from './projectTasks'
import { formatText } from './format'
import { applyEdits, LspManager, type PositionEdit } from './lsp/manager'
import { languageOf } from '@dskripchenko/syntax'
import { readProjectSettings, type ProjectSettings } from './projectSettings'
import { SymbolIndex, type SourceFile } from './symbolIndex'
import {
  abortMerge,
  aheadBehind,
  authorOf,
  branchesOf,
  branchOf,
  commitFile,
  commitFiles,
  conflictsOf,
  createBranch,
  finishMerge,
  GitError,
  historyOf,
  mergeHead,
  remoteOf,
  repoOf,
  repositoryHistory,
  setRemote,
  startHistory,
  statusUnder,
  switchBranch,
  textAt,
  headText,
} from './git'
import { Logins } from './logins'
import { folderDocuments, pdfName, pdfOptions, printToPdfOptions, SLIDES_PDF } from './pdf'
import { builtinTransport, cloneInto, cloneTarget, findSystemGit, syncRepo, systemTransport, type Transport } from './sync'
import { amendLast, createTag, deleteBranch, deleteTag, lastMessage, renameBranch, revertCommit, stashApply, stashDrop, stashList, stashPush } from './gitOps'
import { Buffers, hashText, newBufferId, type Buffer } from './buffers'
import { Consent } from './consent'
import { dataDir } from './dataDir'
import { documentOfUrl, DocumentError, filesFromArgv, openDocument, type OpenedDocument } from './documents'
import { DIAGRAM_SYNTAX, formatByName, isMedia, MARKDOWN_EXT, OPENABLE_EXT, opensInFolio } from './formats'
import { gateNetwork, type NetworkGate } from './network'
import { handleScheme, registerScheme } from './protocol'
import { Roots } from './roots'
import { Session } from './session'
import { labels } from './i18n'
import { listDir } from './tree'
import { Ignores } from './ignore'
import { visibilityOf, type ProjectKind } from './visibility'
import { FileIndex } from './fileIndex'
import { create as createEntry, duplicate as duplicateEntry, FileOpError, move as moveEntry, rename as renameEntry, saveAttachment } from './fileOps'
import { Consoles } from './pty'
import { parseQuery, pathPasses, replaceInFiles, searchFiles, tagsPass, type SearchFile } from './search'
import { patternOf } from '../common/pattern'
import { Watcher } from './watcher'
import { aliasIndex, aliasesOf, backlinksOf, filesOf, isNote, linkMention, linkName, linksOf, mentionsOf, mover, resolveWiki, rewriteLinks, wikiTarget } from './wikilinks'
import { real, resolveInside } from './paths'
import { tagIndex, tagsOf } from './tags'
import { tasksOf, toggleTask } from './tasks'
import { dailyName, dayOf, fillTemplate, neighbourDaily, templatesIn } from './notes'
import { Updater } from './update'
import { Workspace, type Project } from './workspace'

// Before anything reads it: settings, caches and session data live beside the program.
const data = dataDir({ env: process.env, platform: process.platform, execPath: process.execPath, packaged: app.isPackaged, cwd: process.cwd() })
app.setPath('userData', data)
app.setPath('sessionData', join(data, 'chromium'))
app.setPath('logs', join(data, 'logs'))
app.setPath('crashDumps', join(data, 'crashes'))

registerScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

const workspace = new Workspace(data)
const roots = new Roots()
const consent = new Consent(data)
const session = new Session(data)
const buffers = new Buffers(data)
const logins = new Logins(data, {
  available: () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text',
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data),
})

/** Who commits when git is not configured: the system user. */
const fallbackAuthor = () => {
  const name = (() => {
    try {
      return userInfo().username
    } catch {
      return 'folio'
    }
  })()
  return { name, email: `${name}@localhost` }
}
const autoCommit = new AutoCommitter({
  repoOf,
  // A merge in progress is finished as a whole, never a file at a time.
  commitFile: (root, path, message, author) => (mergeHead(root) ? Promise.resolve(null) : commitFile(root, path, message, author)),
  authorOf: (root) => authorOf(root, fallbackAuthor()),
  message: (root, path) => `Update ${relative(root, path).split(sep).join('/')}`,
  committed: (_root, path) => send('git:committed', { path }),
}, Number(process.env.FOLIO_COMMIT_PAUSE) || 3 * 60 * 1000)
let gate: NetworkGate | null = null
/** Native menus speak the system's language; known once the app is ready. */
const L = () => labels(app.isReady() ? app.getLocale() : 'en')
const fileIndex = new FileIndex()
const ignores = new Ignores()
const watcher = new Watcher((changes) => {
  for (const c of changes) {
    // A `.gitignore` written: what is shown under the whole root may change.
    if (ignores.changed(c.files)) {
      fileIndex.forget(c.root)
      ;(c as typeof c & { all?: boolean }).all = true
    }
    fileIndex.changed(c.root, c.files)
  }
  send('fs:changed', changes)
})

/** A folder's kind: its project's (Shared and other folders are notes). */
function kindOfDir(dir: string): ProjectKind {
  const owner = workspace.ownerOf(dir)
  if (owner?.kind !== 'project') return 'notes'
  // The project's own settings say it first (.folio/settings.json), then what it was taken for.
  return settingsOf(owner.project.path).kind ?? owner.project.kind ?? 'notes'
}

/** A project's settings, read again when its file changes (kept a second between looks). */
const settingsCache = new Map<string, { at: number; value: ProjectSettings }>()
function settingsOf(dir: string): ProjectSettings {
  const hit = settingsCache.get(dir)
  if (hit && Date.now() - hit.at < 1000) return hit.value
  const value = readProjectSettings(dir)
  settingsCache.set(dir, { at: Date.now(), value })
  return value
}

/** What the tree, going to a file and searching see under a root's folder. */
const visibility = (dir: string) => visibilityOf(dir, kindOfDir(dir), ignores)
let win: BrowserWindow | null = null

/** Documents' windows have a session of their own: the main process's requests are not theirs. */
const PARTITION = 'persist:documents'

type Opened = OpenedDocument | { error: string; path: string }

function open(path: string): Opened {
  try {
    const doc = openDocument(path, workspace, roots)
    // Its folder is watched: a change on disk reaches the open document, wherever it lives.
    watcher.add(doc.root, roots.dir(doc.root) ?? doc.folder)
    return doc
  } catch (e) {
    return { error: e instanceof DocumentError ? e.message : String(e), path }
  }
}

function send(channel: string, ...args: unknown[]): void {
  win?.webContents.send(channel, ...args)
}

function openInWindow(paths: string[]): void {
  for (const path of paths) send('doc:opened', open(path))
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}

async function openDialog(): Promise<Opened[]> {
  if (!win) return []
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: L().openableFiles, extensions: OPENABLE_EXT.map((e) => e.slice(1)) },
      { name: 'Markdown', extensions: MARKDOWN_EXT.map((e) => e.slice(1)) },
      { name: L().diagramFiles, extensions: ['bpmn', 'dmn', 'drawio', 'dio', ...Object.keys(DIAGRAM_SYNTAX).map((e) => e.slice(1))] },
      { name: 'OpenAPI / AsyncAPI', extensions: ['yaml', 'yml', 'json'] },
      { name: L().allFiles, extensions: ['*'] },
    ],
  })
  return result.canceled ? [] : result.filePaths.map(open)
}

/** Spelling in the window: on or off, the languages folio speaks, and the menu of a field. */
function spelling(w: BrowserWindow): void {
  const ses = w.webContents.session
  ses.setSpellCheckerEnabled(workspace.spellcheck())
  // macOS and Windows check with the system's own languages; elsewhere these are fetched.
  if (process.platform !== 'darwin') {
    const wanted = ['ru', 'en-US'].filter((l) => ses.availableSpellCheckerLanguages.includes(l))
    if (wanted.length > 0) ses.setSpellCheckerLanguages(wanted)
  }
  w.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return
    const items: Electron.MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 6)) items.push({ label: word, click: () => w.webContents.replaceMisspelling(word) })
      if (params.dictionarySuggestions.length === 0) items.push({ label: L().noSuggestions, enabled: false })
      items.push({ label: L().addToDictionary, click: () => ses.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' })
    }
    items.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll' },
    )
    Menu.buildFromTemplate(items).popup({ window: w })
  })
}

/** Updates: the latest release looked for, fetched and checked; it takes over when folio closes. */
const updater = new Updater({
  dir: join(data, 'update'),
  current: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  execPath: process.execPath,
  appImage: process.env.APPIMAGE,
  fetch: (url) => net.fetch(url, { headers: { Accept: 'application/vnd.github+json' } }),
  releases: process.env.FOLIO_UPDATE_URL,
  onState: (state) => send('update:changed', state),
})
ipcMain.handle('update:state', () => ({ state: updater.current, auto: workspace.updates(), current: app.getVersion(), checkable: app.isPackaged || !!process.env.FOLIO_UPDATE_URL }))
ipcMain.handle('update:check', () => (app.isPackaged || process.env.FOLIO_UPDATE_URL ? updater.check() : updater.current))
ipcMain.handle('update:auto', (_e, on: unknown) => {
  if (typeof on === 'boolean') workspace.setUpdates(on)
  return workspace.updates()
})
ipcMain.handle('update:restart', () => {
  if (updater.current.status !== 'ready' || !app.isPackaged) return false
  updater.restartAfter()
  app.quit()
  return true
})

ipcMain.handle('spellcheck:get', () => workspace.spellcheck())
ipcMain.handle('spellcheck:set', (_e, on: unknown) => {
  if (typeof on !== 'boolean') return workspace.spellcheck()
  workspace.setSpellcheck(on)
  for (const w of BrowserWindow.getAllWindows()) w.webContents.session.setSpellCheckerEnabled(on)
  return on
})

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'folio',
    // The window's own icon (Windows, Linux); a packaged Mac app takes it from the bundle.
    icon: join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      // Chromium's PDF viewer for a PDF in its tab (ADR-004 D5); only `folio://app/pdf/` may be framed (index.html's CSP).
      plugins: true,
    },
  })
  // Under test the window shows without taking the focus from the person's own work.
  w.once('ready-to-show', () => (underTest ? w.showInactive() : w.show()))
  spelling(w)
  // A link: another document of a root opens in a tab; the web goes to the system browser.
  const follow = (url: string) => {
    const file = documentOfUrl(url, roots)
    if (file !== null) send('doc:opened', open(file))
    else if (/^https?:\/\//.test(url) || url.startsWith('mailto:')) void shell.openExternal(url)
  }
  w.webContents.setWindowOpenHandler(({ url }) => {
    follow(url)
    return { action: 'deny' }
  })
  // The page is the app: it is never navigated away, a link is followed instead.
  w.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    follow(url)
  })
  void w.loadURL('folio://app/ui/index.html')
  w.on('closed', () => {
    // The window's shells end with it.
    consoles.closeAll()
    win = null
  })
  return w
}

function buildMenu(): void {
  const mac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    {
      label: L().file,
      submenu: [
        { label: L().newNote, accelerator: 'CmdOrCtrl+N', registerAccelerator: false, click: () => send('menu:new-note') },
        { label: L().open, accelerator: 'CmdOrCtrl+O', registerAccelerator: false, click: () => void openDialog().then((docs) => docs.forEach((d) => send('doc:opened', d))) },
        { label: L().goToFile, accelerator: 'CmdOrCtrl+T', registerAccelerator: false, click: () => send('menu:go-to-file') },
        { label: L().addProject, click: () => send('menu:add-project') },
        { label: L().cloneRepo, click: () => send('menu:clone') },
        { label: L().save, accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => send('menu:save') },
        { label: L().saveAs, accelerator: 'CmdOrCtrl+Shift+S', registerAccelerator: false, click: () => send('menu:save-as') },
        { label: L().print, accelerator: 'CmdOrCtrl+P', registerAccelerator: false, click: () => send('menu:print') },
        { label: L().exportPdf, accelerator: 'CmdOrCtrl+Shift+P', registerAccelerator: false, click: () => send('menu:export-pdf') },
        { label: L().closeTab, accelerator: 'CmdOrCtrl+W', registerAccelerator: false, click: () => send('menu:close-tab') },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: L().edit,
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: L().find, accelerator: 'CmdOrCtrl+F', registerAccelerator: false, click: () => send('menu:find', 'open') },
        // As in VS Code: Cmd+G on macOS, F3 elsewhere (Ctrl+G there goes to a line).
        { label: L().findNext, accelerator: process.platform === 'darwin' ? 'Cmd+G' : 'F3', registerAccelerator: false, click: () => send('menu:find', 'next') },
        { label: L().findPrevious, accelerator: process.platform === 'darwin' ? 'Cmd+Shift+G' : 'Shift+F3', registerAccelerator: false, click: () => send('menu:find', 'previous') },
        { type: 'separator' },
        { label: L().findInFiles, accelerator: 'CmdOrCtrl+Shift+F', registerAccelerator: false, click: () => send('menu:find', 'files') },
      ],
    },
    {
      label: L().view,
      submenu: [
        { label: L().commands, accelerator: 'CmdOrCtrl+K', registerAccelerator: false, click: () => send('menu:palette') },
        { label: L().toggleEdit, accelerator: 'CmdOrCtrl+E', registerAccelerator: false, click: () => send('menu:toggle-edit') },
        { label: L().history, accelerator: 'CmdOrCtrl+Shift+H', registerAccelerator: false, click: () => send('menu:toggle-history') },
        { label: L().toggleSidebar, accelerator: 'CmdOrCtrl+B', registerAccelerator: false, click: () => send('menu:toggle-sidebar') },
        { label: L().console, accelerator: 'Ctrl+`', registerAccelerator: false, click: () => send('menu:toggle-console') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// The workspace --------------------------------------------------------------

/** What the sidebar shows: Shared and the projects, each with the root id its tree is listed by. */
function workspaceView() {
  const shared = workspace.shared()
  const sharedId = roots.register(shared)
  watcher.add(sharedId, roots.dir(sharedId) ?? shared)
  return {
    // `path` is the real folder: what open documents' paths are compared with.
    shared: { root: sharedId, path: roots.dir(sharedId) ?? shared },
    projects: workspace.projects().map((p: Project) => {
      const root = roots.register(p.path)
      const dir = roots.dir(root) ?? p.path
      if (!p.hidden) watcher.add(root, dir)
      return { ...p, path: dir, root, missing: !existsSync(p.path) }
    }),
    bookmarks: workspace.bookmarks().map((path) => ({ path, name: basename(path), missing: !existsSync(path) })),
  }
}

function workspaceChanged(): void {
  send('ws:changed', workspaceView())
}

ipcMain.handle('ws:get', () => workspaceView())
/** A file kept at hand in the sidebar's bookmarks, or let go. */
ipcMain.handle('ws:bookmark', (_e, path: unknown, on: unknown) => {
  if (typeof path === 'string' && typeof on === 'boolean') workspace.setBookmark(path, on)
  const view = workspaceView()
  send('ws:changed', view)
  return view
})
ipcMain.handle('ws:add-project', async () => {
  if (!win) return workspaceView()
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections', 'createDirectory'] })
  if (!result.canceled) for (const dir of result.filePaths) workspace.addProject(dir)
  return workspaceView()
})
ipcMain.handle('ws:update-project', (_e, id: unknown, changes: unknown) => {
  if (typeof id !== 'string' || typeof changes !== 'object' || changes === null) return workspaceView()
  const c = changes as Record<string, unknown>
  const allowed: Partial<Project> = {}
  if (typeof c.name === 'string' && c.name.trim() !== '') allowed.name = c.name.trim()
  if (typeof c.group === 'string') allowed.group = c.group.trim() === '' ? undefined : c.group.trim()
  if (typeof c.pinned === 'boolean') allowed.pinned = c.pinned
  if (typeof c.hidden === 'boolean') allowed.hidden = c.hidden
  workspace.updateProject(id, allowed)
  return workspaceView()
})
ipcMain.handle('ws:set-shared', async (_e, reset: unknown) => {
  if (reset === true) workspace.setShared(null)
  else if (win) {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    if (!result.canceled && result.filePaths[0]) workspace.setShared(result.filePaths[0])
  }
  return workspaceView()
})
ipcMain.handle('tree:list', (_e, root: unknown, rel: unknown, all: unknown) => {
  const dir = typeof root === 'string' ? roots.dir(root) : undefined
  if (dir === undefined || typeof rel !== 'string') return null
  // A code project lists every file, as code editors do; a notes project the ones folio opens.
  return listDir(dir, rel, all === true || kindOfDir(dir) === 'code', visibility(dir))
})
/** Shared and the visible projects, each a root: what going to a file and searching cover. */
function sources(): { root: string; label: string | null; dir: string }[] {
  const all = [{ label: null as string | null, path: workspace.shared() }, ...workspace.projects().filter((p) => !p.hidden).map((p) => ({ label: p.name, path: p.path }))]
  return all.map((source) => {
    const root = roots.register(source.path)
    const dir = roots.dir(root) ?? source.path
    watcher.add(root, dir)
    return { root, label: source.label, dir }
  })
}

// Language servers (ADR-003) ---------------------------------------------------------

/** Edits a server asks for, applied by the window; its answer by id. */
const editRequests = new Map<number, (applied: boolean) => void>()
let editSeq = 0
const lsp = new LspManager({
  setting: (root, language) => settingsOf(root).lsp?.[language],
  async trust(root, server) {
    const project = workspace.projects().find((p) => resolve(p.path) === resolve(root))
    if (!project) return false
    if (project.lspTrust !== undefined) return project.lspTrust
    if (!win) return false
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [L().lspTrust, L().lspDistrust],
      defaultId: 0,
      cancelId: 1,
      message: L().lspTrustQuestion.replace('{project}', project.name).replace('{server}', server),
      detail: L().lspTrustDetail,
    })
    workspace.updateProject(project.id, { lspTrust: response === 0 })
    return response === 0
  },
  diagnostics: (path, server, list) => send('lsp:diagnostics', { path, server, list }),
  applyEdit: (edit) =>
    new Promise((resolveApplied) => {
      const id = ++editSeq
      editRequests.set(id, resolveApplied)
      send('lsp:apply-edit', { id, edit })
      setTimeout(() => {
        if (editRequests.delete(id)) resolveApplied(false)
      }, 30_000)
    }),
})
ipcMain.on('lsp:applied', (_e, id: unknown, applied: unknown) => {
  const done = typeof id === 'number' ? editRequests.get(id) : undefined
  editRequests.delete(id as number)
  done?.(applied === true)
})
/** A file opened in the code editor: its language server, in its project (none outside projects). */
ipcMain.handle('lsp:open', async (_e, path: unknown, text: unknown) => {
  if (typeof path !== 'string' || typeof text !== 'string' || !isAbsolute(path)) return { status: 'none', install: null }
  const owner = workspace.ownerOf(path)
  if (owner?.kind !== 'project') return { status: 'none', install: null }
  const language = languageOf(path, text.slice(0, Math.max(0, text.indexOf('\n'))))
  if (!language) return { status: 'none', install: null }
  return lsp.open(path, owner.project.path, language, text)
})
ipcMain.on('lsp:change', (_e, path: unknown, edits: unknown) => {
  if (typeof path === 'string' && Array.isArray(edits)) lsp.change(path, edits as PositionEdit[])
})
ipcMain.on('lsp:save', (_e, path: unknown) => typeof path === 'string' && lsp.save(path))
ipcMain.on('lsp:close', (_e, path: unknown) => typeof path === 'string' && void lsp.close(path))
ipcMain.handle('lsp:request', (_e, path: unknown, method: unknown, params: unknown) =>
  typeof path === 'string' && typeof method === 'string' && /^(textDocument|completionItem|codeAction)\//.test(method)
    ? lsp.request(path, method, (params ?? {}) as Record<string, unknown>)
    : null,
)
ipcMain.handle('lsp:workspace', (_e, path: unknown, method: unknown, params: unknown) =>
  typeof path === 'string' && (method === 'workspace/symbol' || method === 'workspace/executeCommand') ? lsp.workspaceRequest(path, method, params) : null,
)
ipcMain.handle('lsp:log', (_e, path: unknown) => (typeof path === 'string' ? lsp.logOf(path) : null))
/** A server's edits to a file not open in folio: written on disk (inside a project only). */
ipcMain.handle('lsp:edit-file', (_e, path: unknown, edits: unknown) => {
  if (typeof path !== 'string' || !Array.isArray(edits) || workspace.ownerOf(path)?.kind !== 'project') return false
  try {
    const text = readFileSync(path, 'utf8')
    writeFileSync(path, applyEdits(text, edits as PositionEdit[]))
    return true
  } catch {
    return false
  }
})
/** Lines of files (for references' previews): each file read once. */
ipcMain.handle('fs:lines', (_e, items: unknown) => {
  if (!Array.isArray(items)) return []
  const files = new Map<string, string[] | null>()
  return (items as { path: string; line: number }[]).map(({ path, line }) => {
    if (typeof path !== 'string' || workspace.ownerOf(path) === null) return ''
    if (!files.has(path)) {
      try {
        files.set(path, readFileSync(path, 'utf8').split(/\r?\n/))
      } catch {
        files.set(path, null)
      }
    }
    return files.get(path)?.[line]?.trim().slice(0, 200) ?? ''
  })
})

/** The settings of the project a file is in (`.folio/settings.json`), for its editor's indentation. */
ipcMain.handle('project:settings', (_e, path: unknown) => {
  const owner = typeof path === 'string' ? workspace.ownerOf(path) : null
  return owner?.kind === 'project' ? settingsOf(owner.project.path) : {}
})
/** Keys of one's own (`folio-data/keybindings.json`): `[{ "key": "Mod-Shift-d", "command": "copyLineDown" }]`. */
ipcMain.handle('keybindings:get', () => {
  try {
    const list = JSON.parse(readFileSync(join(data, 'keybindings.json'), 'utf8')) as unknown
    return Array.isArray(list)
      ? list.filter((b): b is { key: string; command: string } => !!b && typeof b.key === 'string' && typeof b.command === 'string')
      : []
  } catch {
    return []
  }
})

/** A file's text formatted before it is saved, when its project asks for it (ADR-002, I3); null otherwise. */
ipcMain.handle('doc:format', async (_e, path: unknown, text: unknown) => {
  if (typeof path !== 'string' || typeof text !== 'string') return null
  const owner = workspace.ownerOf(path)
  if (owner?.kind !== 'project') return null
  return formatText(owner.project.path, path, text)
})

/** The tasks of the project (or Shared) a path is in (ADR-002, I3), with the folder they run in. */
ipcMain.handle('tasks:list', (_e, path: unknown) => {
  const owner = typeof path === 'string' ? ownerFolder(path) : null
  if (!owner) return null
  return { dir: owner.dir, tasks: projectTasksOf(owner.dir) }
})

/** The symbols of every visible project's code: going to a symbol across projects, completing names. */
const symbolIndex = new SymbolIndex()
ipcMain.handle('symbols:project', async () => {
  const files: SourceFile[] = []
  for (const s of sources()) {
    if (s.label === null) continue
    for (const f of await fileIndex.files(s.root, s.dir, visibility(s.dir))) if (f.kind === 'code') files.push({ root: s.root, label: s.label, dir: s.dir, path: f.path })
  }
  return symbolIndex.symbolsOf(files)
})

/** Every file folio opens in Shared and the visible projects: for going to a file by name. */
ipcMain.handle('files:all', async () => {
  const out: { root: string; label: string | null; path: string; kind: string }[] = []
  for (const s of sources()) for (const f of await fileIndex.files(s.root, s.dir, visibility(s.dir))) out.push({ root: s.root, label: s.label, path: f.path, kind: f.kind })
  return out
})

// Searching the files' text: one search at a time, a newer one stops the older.
let searchId = 0
ipcMain.handle('search:scopes', () => sources().map(({ root, label }) => ({ root, label })))
ipcMain.handle('search:run', async (e, id: unknown, query: unknown, options: unknown, scope: unknown) => {
  if (typeof id !== 'number' || typeof query !== 'string' || typeof options !== 'object' || options === null) return { error: 'invalid' }
  searchId = id
  const o = options as Record<string, unknown>
  const q = parseQuery(query)
  const filtered = q.tags.length + q.paths.length + q.files.length > 0
  // Filters alone: a tag's places, or each file's first line.
  const pattern =
    q.text !== '' || !filtered
      ? patternOf(q.text, { caseSensitive: o.caseSensitive === true, wholeWord: o.wholeWord === true, regex: o.regex === true })
      : q.tags.length > 0
        ? new RegExp(`(?<![\\p{L}\\p{N}_])#${q.tags[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu')
        : /^.*\S.*$/m
  if (!pattern) return { error: 'invalid' }
  const files: SearchFile[] = []
  for (const s of sources()) {
    if (scope !== 'all' && scope !== s.root) continue
    for (const f of await fileIndex.files(s.root, s.dir, visibility(s.dir)))
      // A picture, a video, a sound has no text to search (an SVG has: it stays).
      if (pathPasses(q, f.path) && !isMedia(formatByName(f.path))) files.push({ root: s.root, label: s.label, dir: s.dir, path: f.path })
  }
  return searchFiles(files, pattern, (batch) => e.sender.send('search:hits', id, batch), () => searchId !== id, {
    ...(q.tags.length > 0 ? { accept: (text: string) => tagsPass(q, tagsOf(text)) } : {}),
    ...(q.text === '' && filtered && q.tags.length === 0 ? { perFile: 1 } : {}),
  })
})
/** Replace the matches in the files chosen; a folder that keeps a history gets one commit for it. */
ipcMain.handle('search:replace', async (_e, query: unknown, options: unknown, replacement: unknown, files: unknown) => {
  if (typeof query !== 'string' || typeof replacement !== 'string' || typeof options !== 'object' || options === null || !Array.isArray(files)) return { error: 'invalid' }
  const o = options as Record<string, unknown>
  // The filters chose the files; what is replaced is the text of the query.
  const text = parseQuery(query).text
  if (text === '') return { error: 'invalid' }
  const pattern = patternOf(text, { caseSensitive: o.caseSensitive === true, wholeWord: o.wholeWord === true, regex: o.regex === true })
  if (!pattern) return { error: 'invalid' }
  // Only files of the roots folio knows: the window names them, the main process checks.
  const known = new Set(sources().map((s) => s.dir))
  const allowed = files.filter((f): f is string => typeof f === 'string' && [...known].some((dir) => f.startsWith(dir + sep)))
  const { changed, replacements } = await replaceInFiles(allowed, pattern, o.regex === true ? replacement : replacement.replace(/\$/g, '$$$$'))
  // One commit per history: the replacement as one change, not a commit per file later.
  const byRepo = new Map<string, string[]>()
  for (const file of changed) {
    if (!workspace.autoCommits(file)) continue
    const repo = await repoOf(file)
    if (!repo || mergeHead(repo)) continue
    autoCommit.cancel(file)
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), file])
  }
  let commits = 0
  for (const [repo, list] of byRepo) {
    const oid = await commitFiles(repo, list, `Replace "${query}" with "${replacement}"`, authorOf(repo, fallbackAuthor()))
    if (oid) {
      commits++
      for (const path of list) send('git:committed', { path })
    }
  }
  return { files: changed.length, replacements, commits }
})
// Consoles: a shell per tab, in a folder (Shared when none is named).
const consoles = new Consoles(
  {
    data: (id, data) => send('console:data', id, data),
    exit: (id, code) => send('console:exit', id, code),
  },
  join(data, 'shell-integration'),
)
ipcMain.handle('console:open', (_e, cwd: unknown, cols: unknown, rows: unknown, command: unknown) => {
  const dir = typeof cwd === 'string' && existsSync(cwd) && statSync(cwd).isDirectory() ? cwd : workspace.shared()
  const opened = consoles.open(dir, Number(cols) || 80, Number(rows) || 24, typeof command === 'string' && command.trim() !== '' ? command : undefined)
  return 'id' in opened ? { ...opened, cwd: dir } : opened
})
/** A path in a console's output (`src/a.ts:12:3`, `~/notes.md`): the file it names, from the console's folder. */
ipcMain.handle('console:resolve', (_e, cwd: unknown, text: unknown) => {
  if (typeof text !== 'string') return null
  const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(text.trim())
  if (!m || !m[1]) return null
  let path = m[1]
  if (path.startsWith('~')) path = join(homedir(), path.slice(1))
  const base = typeof cwd === 'string' && cwd !== '' ? cwd : workspace.shared()
  const file = isAbsolute(path) ? path : join(base, path)
  try {
    if (!statSync(file).isFile()) return null
  } catch {
    return null
  }
  // The real path, as a document's: the same file is one tab, its problems its own (/var is /private/var on macOS).
  return { path: real(file) ?? file, line: m[2] ? Number(m[2]) : null, column: m[3] ? Number(m[3]) : null }
})
ipcMain.on('console:input', (_e, id: unknown, data: unknown) => {
  if (typeof id === 'number' && typeof data === 'string') consoles.write(id, data)
})
ipcMain.on('console:resize', (_e, id: unknown, cols: unknown, rows: unknown) => {
  if (typeof id === 'number') consoles.resize(id, Number(cols), Number(rows))
})
ipcMain.on('console:close', (_e, id: unknown) => {
  if (typeof id === 'number') consoles.close(id)
})

ipcMain.on('search:cancel', () => {
  searchId++
})
ipcMain.handle('tree:open', (_e, root: unknown, rel: unknown) => {
  const file = typeof root === 'string' && typeof rel === 'string' ? roots.resolve(root, rel) : null
  if (file === null) return { error: 'Not a file of this folder', path: String(rel) }
  // A file that is not text (a picture, an archive, a build's output) goes to the system's program for it.
  if (!opensInFolio(file) && isBinary(file)) {
    void shell.openPath(file)
    return { external: true, path: file }
  }
  return open(file)
})

/** A file of the workspace (a picture folio shows, say) in the system's program for it. */
ipcMain.handle('file:external', async (_e, path: unknown) => {
  if (typeof path !== 'string' || !isAbsolute(path) || workspace.ownerOf(path) === null || !existsSync(path)) return false
  return (await shell.openPath(path)) === ''
})

/** Whether a file holds bytes no text has (a NUL among its first 8 KB), as git tells binary files. */
function isBinary(file: string): boolean {
  try {
    const fd = openSync(file, 'r')
    try {
      const buf = Buffer.alloc(8192)
      const n = readSync(fd, buf, 0, buf.length, 0)
      return buf.subarray(0, n).includes(0)
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}
// Files and folders from the tree: made, renamed, moved, copied, put in the trash.

/** An operation's error as a word the window shows ('exists', 'characters'…). */
function fileOp<T>(op: () => T): T | { error: string } {
  try {
    return op()
  } catch (e) {
    return { error: e instanceof FileOpError ? e.message : 'failed' }
  }
}

/** Moved or renamed: open documents follow, the histories take both sides. */
function moved(from: string, to: string): void {
  if (workspace.moveBookmarks(from, to)) workspaceChanged()
  send('fs:moved', { from, to })
  for (const p of [from, to]) if (workspace.autoCommits(p) && statSync(to).isFile()) autoCommit.saved(p)
}

async function trash(file: string): Promise<void> {
  if (!win) return
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [L().trashConfirm, L().cancel],
    defaultId: 0,
    cancelId: 1,
    message: L().trashQuestion.replace('{name}', basename(file)),
    detail: L().trashDetail,
  })
  if (response !== 0) return
  await shell.trashItem(file)
  send('fs:removed', { path: file })
  if (workspace.autoCommits(file) && !existsSync(file)) autoCommit.saved(file)
}

ipcMain.handle('fs:trash', async (_e, root: unknown, rel: unknown) => {
  const path = typeof root === 'string' && typeof rel === 'string' ? roots.resolve(root, rel) : null
  if (path === null || path === roots.dir(root as string)) return
  await trash(path)
})
ipcMain.handle('fs:create', (_e, root: unknown, dir: unknown, name: unknown, kind: unknown) => {
  const folder = typeof root === 'string' && typeof dir === 'string' ? roots.resolve(root, dir) : null
  if (folder === null || typeof name !== 'string' || (kind !== 'note' && kind !== 'folder')) return { error: 'failed' }
  return fileOp(() => {
    const path = createEntry(folder, name, kind)
    if (kind === 'note' && workspace.autoCommits(path)) autoCommit.saved(path)
    return { path, rel: relative(roots.dir(root as string)!, path).split(sep).join('/') }
  })
})
ipcMain.handle('fs:rename', (_e, root: unknown, rel: unknown, name: unknown) => {
  const path = typeof root === 'string' && typeof rel === 'string' ? roots.resolve(root, rel) : null
  if (path === null || typeof name !== 'string' || path === roots.dir(root as string)) return { error: 'failed' }
  return fileOp(() => {
    const to = renameEntry(path, name)
    if (to !== path) moved(path, to)
    return { from: path, to }
  })
})
ipcMain.handle('fs:move', (_e, fromRoot: unknown, fromRel: unknown, toRoot: unknown, toDir: unknown) => {
  const path = typeof fromRoot === 'string' && typeof fromRel === 'string' ? roots.resolve(fromRoot, fromRel) : null
  const dir = typeof toRoot === 'string' && typeof toDir === 'string' ? roots.resolve(toRoot, toDir) : null
  if (path === null || dir === null || path === roots.dir(fromRoot as string)) return { error: 'failed' }
  return fileOp(() => {
    const to = moveEntry(path, dir)
    if (to !== path) moved(path, to)
    return { from: path, to }
  })
})

// Links between notes: `[[Name]]` names a file of the note's root, wherever it lies.

/** The folder a note's links are resolved in: the root that holds it, or its own folder. */
function linkRoot(file: string): string {
  const holding = sources().filter((s) => file.startsWith(s.dir + sep)).sort((a, b) => b.dir.length - a.dir.length)[0]
  return holding?.dir ?? dirname(file)
}
const relIn = (dir: string, file: string): string => relative(dir, file).split(sep).join('/')
/** A file of a folder folio knows: a project, Shared, or the folder of a document it opened. */
function knownFile(file: string): boolean {
  return sources().some((s) => file.startsWith(s.dir + sep)) || roots.dir(Roots.idOf(dirname(file))) !== undefined
}

/** Which of a note's link targets reach a file: for showing the missing ones. */
ipcMain.handle('wiki:exists', async (_e, from: unknown, targets: unknown) => {
  if (typeof from !== 'string' || !Array.isArray(targets)) return []
  const dir = linkRoot(from)
  const files = await filesOf(dir)
  const aliases = aliasIndex(await notesIn(dir, files))
  return targets.map((t) => typeof t === 'string' && resolveWiki(wikiTarget(t).name, relIn(dir, from), files, aliases) !== null)
})

/**
 * A link looked at, not followed (a preview while the pointer rests on it):
 * the note it reaches, read — nothing opened, made or watched. Null for a
 * link to no note, or to a file that is not Markdown.
 */
ipcMain.handle('doc:peek', async (_e, from: unknown, link: unknown) => {
  if (typeof link !== 'object' || link === null) return null
  const l = link as { wiki?: unknown; url?: unknown }
  let file: string | null = null
  let heading: string | null = null
  if (typeof l.wiki === 'string' && typeof from === 'string') {
    const dir = linkRoot(from)
    const target = wikiTarget(l.wiki)
    heading = target.heading
    const files = await filesOf(dir)
    const found = resolveWiki(target.name, relIn(dir, from), files, aliasIndex(await notesIn(dir, files)))
    file = found === null ? null : join(dir, ...found.split('/'))
  } else if (typeof l.url === 'string') {
    file = documentOfUrl(l.url, roots)
    heading = decodeURIComponent(/#(.+)$/.exec(l.url)?.[1] ?? '') || null
  }
  if (file === null || !existsSync(file)) return null
  // A picture, a video, a sound (an SVG too): its URL to draw, never its bytes.
  const kind = formatByName(file)
  if (isMedia(kind) || kind === 'svg') {
    try {
      const doc = openDocument(file, workspace, roots)
      return { path: doc.path, name: doc.name, text: '', base: doc.base, heading: null, media: kind }
    } catch {
      return null
    }
  }
  if (!isNote(file)) return null
  try {
    if (statSync(file).size > 2 * 1024 * 1024) return null
    const doc = openDocument(file, workspace, roots)
    return { path: file, name: doc.name, text: doc.text, base: doc.base, heading }
  } catch {
    return null
  }
})

/** A link followed: the file it names opens; a note that is not there yet is made first. */
ipcMain.handle('wiki:open', async (_e, from: unknown, target: unknown) => {
  if (typeof from !== 'string' || typeof target !== 'string') return { error: 'invalid', path: '' }
  const dir = linkRoot(from)
  const { name, heading } = wikiTarget(target)
  const files = await filesOf(dir)
  const found = resolveWiki(name, relIn(dir, from), files, aliasIndex(await notesIn(dir, files)))
  if (found !== null) return { ...open(join(dir, ...found.split('/'))), heading }
  // A new note: beside the linking one, or at the path the link names.
  const folder = name.includes('/') ? resolveInside(dir, dirname(name)) : dirname(from)
  if (folder === null) return { error: 'invalid', path: name }
  const made = fileOp(() => {
    mkdirSync(folder, { recursive: true })
    return createEntry(folder, basename(name), 'note')
  })
  if (typeof made !== 'string') return { ...made, path: name }
  if (workspace.autoCommits(made)) autoCommit.saved(made)
  return { ...open(made), heading, created: true }
})

/** The files a note can link to, each by the name a link would use: for suggesting after `[[`. */
ipcMain.handle('wiki:names', async (_e, from: unknown) => {
  if (typeof from !== 'string') return []
  const dir = linkRoot(from)
  const files = await filesOf(dir)
  const self = relIn(dir, from)
  const names = files.filter((f) => f !== self && kindOfLink(f)).map((f) => ({ name: linkName(f, files), path: f, label: undefined as string | undefined }))
  // A note's aliases too: chosen, the link names the note and shows the alias.
  for (const n of await notesIn(dir, files)) {
    if (n.rel === self) continue
    for (const alias of aliasesOf(n.text)) names.push({ name: `${linkName(n.rel, files)}|${alias}`, path: n.rel, label: alias })
  }
  return names
})
/** What a link suggests: notes, diagrams and pictures, not every file of a project. */
function kindOfLink(rel: string): boolean {
  return isNote(rel) || /\.(png|jpe?g|gif|svg|webp|avif|pdf|bpmn|dmn|drawio|dio|mmd|puml|excalidraw)$/i.test(rel)
}

/**
 * A file or folder moved within a root: the links to it in the root's notes,
 * and the moved notes' own relative links, are written anew. Notes open with
 * unsaved changes (`skip`) are left as they are. The number of notes changed.
 */
ipcMain.handle('wiki:moved', async (_e, from: unknown, to: unknown, skip: unknown) => {
  if (typeof from !== 'string' || typeof to !== 'string') return 0
  const dir = linkRoot(to)
  if (linkRoot(from) !== dir) return 0
  const skipped = new Set(Array.isArray(skip) ? skip.filter((s): s is string => typeof s === 'string') : [])
  const map = mover(relIn(dir, from), relIn(dir, to))
  const after = await filesOf(dir)
  const toRel = relIn(dir, to)
  const back = mover(toRel, relIn(dir, from))
  const before = after.map((f) => back(f) ?? f)
  const name = basename(from).replace(/\.(md|markdown)$/i, '').toLowerCase()
  let changed = 0
  for (const rel of after) {
    if (!isNote(rel)) continue
    const file = join(dir, ...rel.split('/'))
    if (skipped.has(file)) continue
    const relBefore = back(rel) ?? rel
    let text: string
    try {
      if (statSync(file).size > 4 * 1024 * 1024) continue
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    // Only notes that may name it, or that moved themselves.
    if (relBefore === rel && !text.toLowerCase().includes(name) && !text.toLowerCase().includes(encodeURIComponent(name).toLowerCase())) continue
    const next = rewriteLinks(text, relBefore, rel, map, before, after)
    if (next === text) continue
    writeFileSync(file, next)
    changed++
    if (workspace.autoCommits(file)) autoCommit.saved(file)
  }
  return changed
})

/** The notes of a root, read once and kept while unchanged on disk: for the links panel. */
const noteTexts = new Map<string, { mtime: number; size: number; text: string }>()
const MAX_NOTES = 5000
async function notesIn(dir: string, files: string[]): Promise<{ rel: string; text: string }[]> {
  const out: { rel: string; text: string }[] = []
  for (const rel of files) {
    if (!isNote(rel) || out.length >= MAX_NOTES) continue
    const file = join(dir, ...rel.split('/'))
    try {
      const st = statSync(file)
      if (st.size > 4 * 1024 * 1024) continue
      let hit = noteTexts.get(file)
      if (!hit || hit.mtime !== st.mtimeMs || hit.size !== st.size) {
        hit = { mtime: st.mtimeMs, size: st.size, text: readFileSync(file, 'utf8') }
        noteTexts.set(file, hit)
      }
      out.push({ rel, text: hit.text })
    } catch {
      // Gone meanwhile.
    }
  }
  return out
}

/**
 * The links panel of a note: its links (from `text`, the note as it is in
 * its tab, saved or not), the notes linking to it, and the ones that name it
 * without a link.
 */
ipcMain.handle('wiki:panel', async (_e, note: unknown, text: unknown) => {
  if (typeof note !== 'string' || typeof text !== 'string') return null
  const dir = linkRoot(note)
  const files = await filesOf(dir)
  const rel = relIn(dir, note)
  const notes = await notesIn(dir, files)
  const aliases = aliasIndex(notes)
  const abs = (r: string): string => join(dir, ...r.split('/'))
  return {
    name: linkName(rel, files),
    outgoing: linksOf(text, rel, files, aliases).map((l) => ({ ...l, path: l.target === null ? null : abs(l.target) })),
    incoming: backlinksOf(rel, notes, files, aliases).map((b) => ({ ...b, path: abs(b.rel) })),
    mentions: mentionsOf(rel, notes).map((m) => ({ ...m, path: abs(m.rel) })),
  }
})

// Daily notes and templates.

/**
 * A daily note: today's (made when missing — from the `Daily` template when
 * there is one), or the one before or after the day of a daily note (`step`).
 */
ipcMain.handle('daily:open', (_e, from: unknown, step: unknown) => {
  const folder = workspace.dailyFolder()
  if (step === -1 || step === 1) {
    const day = (typeof from === 'string' ? dayOf(from) : null) ?? new Date()
    const name = neighbourDaily(folder, day, step)
    return name === null ? { error: 'none', path: '' } : open(join(folder, name))
  }
  const now = new Date()
  const file = join(folder, dailyName(now))
  if (!existsSync(file)) {
    const title = dailyName(now).replace(/\.md$/, '')
    const template = join(workspace.templatesFolder(), 'Daily.md')
    const text = existsSync(template) ? fillTemplate(readFileSync(template, 'utf8'), { title, now }) : `# ${title}\n\n`
    try {
      mkdirSync(folder, { recursive: true })
      writeFileSync(file, text, { flag: 'wx' })
      if (workspace.autoCommits(file)) autoCommit.saved(file)
    } catch {
      // Made meanwhile (another window): opened as it is.
    }
  }
  return open(file)
})

ipcMain.handle('templates:list', () => {
  const folder = workspace.templatesFolder()
  return templatesIn(folder).map((t) => ({ name: t.name, path: join(folder, t.file) }))
})

/** A template's text with its fields filled (the title given, the date and time now). */
ipcMain.handle('templates:fill', (_e, path: unknown, title: unknown) => {
  if (typeof path !== 'string' || !path.startsWith(workspace.templatesFolder() + sep) || !existsSync(path)) return null
  return fillTemplate(readFileSync(path, 'utf8'), { title: typeof title === 'string' ? title : '', now: new Date() })
})

ipcMain.handle('folders:get', () => ({ daily: workspace.dailyFolder(), templates: workspace.templatesFolder() }))

/** The daily notes' or the templates' folder chosen anew. */
ipcMain.handle('folders:choose', async (_e, kind: unknown) => {
  if ((kind !== 'daily' && kind !== 'templates') || !win) return null
  const current = kind === 'daily' ? workspace.dailyFolder() : workspace.templatesFolder()
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: existsSync(current) ? current : workspace.shared() })
  if (result.canceled || !result.filePaths[0]) return null
  if (kind === 'daily') workspace.setDailyFolder(result.filePaths[0])
  else workspace.setTemplatesFolder(result.filePaths[0])
  return result.filePaths[0]
})

/**
 * The graph of a note's root (Shared without one): its notes, and the links
 * between them (`[[…]]` and Markdown links to notes), each pair once.
 */
ipcMain.handle('graph:data', async (_e, note: unknown) => {
  const dir = typeof note === 'string' ? linkRoot(note) : workspace.shared()
  const files = await filesOf(dir)
  const notes = await notesIn(dir, files)
  const aliases = aliasIndex(notes)
  const index = new Map(notes.map((n, i) => [n.rel, i]))
  const pairs = new Set<string>()
  const edges: [number, number][] = []
  notes.forEach((n, i) => {
    for (const link of linksOf(n.text, n.rel, files, aliases)) {
      const j = link.target === null ? undefined : index.get(link.target)
      if (j === undefined || j === i) continue
      const key = i < j ? `${i}:${j}` : `${j}:${i}`
      if (pairs.has(key)) continue
      pairs.add(key)
      edges.push([i, j])
    }
  })
  return {
    nodes: notes.map((n) => ({ rel: n.rel, path: join(dir, ...n.rel.split('/')), name: basename(n.rel).replace(/\.(md|markdown)$/i, '') })),
    edges,
  }
})

/** The tasks of the notes in a note's root (Shared without one). */
ipcMain.handle('tasks:index', async (_e, note: unknown) => {
  const dir = typeof note === 'string' ? linkRoot(note) : workspace.shared()
  const notes = await notesIn(dir, await filesOf(dir))
  return notes.flatMap((n) => tasksOf(n.text).map((t) => ({ ...t, rel: n.rel, path: join(dir, ...n.rel.split('/')) })))
})

/** A task checked or unchecked in its note; false when the note changed meanwhile. */
ipcMain.handle('tasks:toggle', (_e, path: unknown, line: unknown, raw: unknown, done: unknown) => {
  if (typeof path !== 'string' || typeof line !== 'number' || typeof raw !== 'string' || typeof done !== 'boolean') return false
  if (!isNote(path) || !knownFile(path)) return false
  try {
    const next = toggleTask(readFileSync(path, 'utf8'), line, raw, done)
    if (next === null) return false
    writeFileSync(path, next)
    if (workspace.autoCommits(path)) autoCommit.saved(path)
    return true
  } catch {
    return false
  }
})

/** A new kanban board, calendar or whiteboard, beside the note in view (in Shared without one), from a starting markup. */
ipcMain.handle('fs:new-kind', (_e, kind: unknown, near: unknown) => {
  if (kind !== 'kanban' && kind !== 'calendar' && kind !== 'board') return { error: 'invalid', path: '' }
  const folder = typeof near === 'string' && knownFile(near) ? dirname(near) : workspace.shared()
  const day = new Date().toISOString().slice(0, 10)
  const base = kind === 'kanban' ? L().newBoardName : kind === 'calendar' ? L().newCalendarName : L().newCanvasName
  const text =
    kind === 'kanban'
      ? `# ${base}\n\n## ${L().boardTodo}\n- ${L().boardFirst}\n\n## ${L().boardDoing} {wip: 3}\n\n## ${L().boardDone} {done}\n`
      : kind === 'calendar'
        ? `# ${base}\n\n${day} ${L().calendarFirst}\n`
        : `${JSON.stringify({ version: 1, objects: {} }, null, 2)}\n`
  const ext = kind === 'board' ? 'board' : `${kind}.md`
  for (let i = 0; ; i++) {
    const file = join(folder, `${base}${i === 0 ? '' : ` ${i}`}.${ext}`)
    try {
      writeFileSync(file, text, { flag: 'wx' })
      if (workspace.autoCommits(file)) autoCommit.saved(file)
      return open(file)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return { error: 'failed', path: file }
    }
  }
})

/** The tags of the notes in a note's root (Shared when no note is given), each with its notes. */
ipcMain.handle('tags:index', async (_e, note: unknown) => {
  const dir = typeof note === 'string' ? linkRoot(note) : workspace.shared()
  const notes = await notesIn(dir, await filesOf(dir))
  return tagIndex(notes).map((t) => ({ tag: t.tag, notes: t.notes.map((rel) => ({ rel, path: join(dir, ...rel.split('/')) })) }))
})

/** A mention made a link in the note that names it; false when its text has changed meanwhile. */
ipcMain.handle('wiki:link-mention', (_e, file: unknown, index: unknown, length: unknown, link: unknown) => {
  if (typeof file !== 'string' || typeof index !== 'number' || typeof length !== 'number' || typeof link !== 'string') return false
  if (!isNote(file) || !knownFile(file)) return false
  try {
    const next = linkMention(readFileSync(file, 'utf8'), index, length, link)
    if (next === null) return false
    writeFileSync(file, next)
    if (workspace.autoCommits(file)) autoCommit.saved(file)
    return true
  } catch {
    return false
  }
})

/** A picture pasted or dropped into a note: saved in `attachments/` beside it; its path for the Markdown. */
ipcMain.handle('image:save', (_e, note: unknown, name: unknown, type: unknown, bytes: unknown) => {
  if (typeof note !== 'string' || typeof name !== 'string' || typeof type !== 'string' || !(bytes instanceof Uint8Array)) return { error: 'failed' }
  // Only beside a note folio has open from a folder it knows, and not a file of any size.
  if (!knownFile(note) || !MARKDOWN_EXT.includes(extname(note).toLowerCase()) || !existsSync(note)) return { error: 'failed' }
  if (bytes.byteLength > 64 * 1024 * 1024) return { error: 'large' }
  return fileOp(() => {
    const path = saveAttachment(note, name, type, bytes)
    const file = join(dirname(note), ...path.split('/'))
    if (workspace.autoCommits(file)) autoCommit.saved(file)
    return { path }
  })
})

/** A file chosen in the tree to compare another with ("Select for compare", as in VS Code). */
let compareFrom: string | null = null

ipcMain.on('tree:menu', (_e, root: unknown, rel: unknown) => {
  const file = typeof root === 'string' && typeof rel === 'string' ? roots.resolve(root, rel) : null
  if (file === null || !win) return
  const folder = existsSync(file) && statSync(file).isDirectory()
  // The folder new entries go into: this one, or the file's own.
  const dirRel = folder ? rel : (rel as string).split('/').slice(0, -1).join('/')
  Menu.buildFromTemplate([
    { label: L().newNoteHere, click: () => send('tree:create', { root, dir: dirRel, kind: 'note' }) },
    { label: L().newFolder, click: () => send('tree:create', { root, dir: dirRel, kind: 'folder' }) },
    { type: 'separator' },
    { label: L().renameEntry, click: () => send('tree:rename', { root, rel }) },
    { label: L().duplicate, click: () => void fileOp(() => duplicateEntry(file)) },
    { label: L().trash, click: () => void trash(file) },
    { type: 'separator' },
    { label: folder ? L().exportFolderPdf : L().exportPdf, click: () => send(folder ? 'menu:export-folder' : 'menu:export-file', file) },
    { label: L().consoleHere, click: () => send('menu:console', folder ? file : dirname(file)) },
    { label: L().reveal, click: () => shell.showItemInFolder(file) },
    // Two files compared: one chosen first, the other compared with it.
    ...(folder
      ? []
      : [
          { type: 'separator' as const },
          { label: L().selectForCompare, click: () => (compareFrom = file) },
          ...(compareFrom && compareFrom !== file && existsSync(compareFrom)
            ? [{ label: L().compareWith.replace('{name}', basename(compareFrom)), click: () => send('compare:files', { a: compareFrom, b: file }) }]
            : []),
        ]),
    ...(folder
      ? []
      : [{ type: 'separator' as const }, workspace.bookmarks().includes(resolve(file))
          ? { label: L().unbookmark, click: () => { workspace.setBookmark(file, false); workspaceChanged() } }
          : { label: L().bookmark, click: () => { workspace.setBookmark(file, true); workspaceChanged() } }]),
  ]).popup({ window: win })
})
/** A project's menu, native: pin, rename, group, hide, reveal, remove. */
ipcMain.on('ws:project-menu', (_e, id: unknown) => {
  const project = workspace.projects().find((p) => p.id === id)
  if (!project || !win) return
  const update = (changes: Partial<Project>) => {
    workspace.updateProject(project.id, changes)
    workspaceChanged()
  }
  Menu.buildFromTemplate([
    { label: project.pinned ? L().unpin : L().pin, click: () => update({ pinned: !project.pinned }) },
    { label: L().rename, click: () => send('ws:edit', { id: project.id, field: 'name' }) },
    { label: L().group, click: () => send('ws:edit', { id: project.id, field: 'group' }) },
    { label: project.hidden ? L().show : L().hide, click: () => update({ hidden: !project.hidden }) },
    { type: 'separator' },
    // Notes or code: what the tree shows, and whether a save commits (a code project commits by hand).
    ...(['notes', 'code'] as const).map((kind) => ({
      label: kind === 'notes' ? L().kindNotes : L().kindCode,
      type: 'radio' as const,
      checked: (project.kind ?? 'notes') === kind,
      click: () => {
        if ((project.kind ?? 'notes') === kind) return
        update({ kind })
        const root = roots.register(project.path)
        fileIndex.forget(root)
        send('fs:changed', [{ root, dirs: [], files: [], all: true }])
      },
    })),
    { type: 'separator' },
    { label: L().newNoteHere, click: () => send('tree:create', { root: roots.register(project.path), dir: '', kind: 'note' }) },
    { label: L().newFolder, click: () => send('tree:create', { root: roots.register(project.path), dir: '', kind: 'folder' }) },
    { type: 'separator' },
    { label: L().exportFolderPdf, click: () => send('menu:export-folder', project.path) },
    { label: L().consoleHere, click: () => send('menu:console', project.path) },
    { label: L().reveal, click: () => void shell.openPath(project.path) },
    {
      label: L().remove,
      click: () => {
        workspace.removeProject(project.id)
        watcher.remove(roots.register(project.path))
        workspaceChanged()
      },
    },
  ]).popup({ window: win })
})

// History (git) -------------------------------------------------------------------

/** The folder a file belongs to, for its history settings: a project, Shared, or none. */
function ownerFolder(path: string): { kind: 'project'; id: string; dir: string } | { kind: 'shared'; dir: string } | null {
  const owner = workspace.ownerOf(path)
  if (owner?.kind === 'project') return { kind: 'project', id: owner.project.id, dir: owner.project.path }
  if (owner?.kind === 'shared') return { kind: 'shared', dir: workspace.shared() }
  return null
}

async function gitInfo(path: string) {
  const root = await repoOf(path)
  const owner = ownerFolder(path)
  const branches = root ? await branchesOf(root) : { current: null, local: [] }
  const remote = root ? await remoteOf(root) : null
  return {
    root,
    branch: branches.current,
    branches: branches.local,
    remote: remote?.url ?? null,
    counts: root && remote && branches.current ? await aheadBehind(root, branches.current, remote.name) : null,
    merging: root && mergeHead(root) ? { conflicts: await conflictsOf(root) } : null,
    transport: (await transportOf()).kind,
    autoCommit: workspace.autoCommits(path),
    // History can be started in the file's project or Shared folder.
    canStart: root === null && owner !== null,
    // A code project commits by hand (ADR-002, I1).
    canAutoCommit: owner !== null && kindOfDir(path) !== 'code',
  }
}

/** The network for sync and clone: the system git when there is one, else the built-in one. */
let transport: Promise<Transport> | null = null
const transportOf = () =>
  (transport ??= findSystemGit().then((bin) => (bin ? systemTransport(bin) : builtinTransport((url) => logins.get(url)))))

/** A git action for the window: its result, or the refusal as `{ error, detail }`. */
async function gitAction<T>(path: unknown, act: (root: string) => Promise<T>): Promise<T | { error: string; detail: string[] }> {
  if (typeof path !== 'string') return { error: 'invalid', detail: [] }
  const root = await repoOf(path)
  if (!root) return { error: 'invalid', detail: [] }
  try {
    return await act(root)
  } catch (e) {
    if (e instanceof GitError) return { error: e.code, detail: e.detail }
    return { error: 'network', detail: [e instanceof Error ? e.message : String(e)] }
  } finally {
    // Branches and merges change files and statuses: the tree and the panel look again.
    send('git:committed', { path })
  }
}

ipcMain.handle('git:info', (_e, path: unknown) => (typeof path === 'string' ? gitInfo(path) : null))
/** The file's versions, or (`all`) every commit of its repository. */
ipcMain.handle('git:history', async (_e, path: unknown, scope: unknown) => {
  if (typeof path !== 'string') return []
  const root = await repoOf(path)
  if (!root) return []
  return scope === 'all' ? repositoryHistory(root) : historyOf(root, path)
})
ipcMain.handle('git:text-at', async (_e, path: unknown, oid: unknown) => {
  if (typeof path !== 'string' || typeof oid !== 'string' || !/^[0-9a-f]{40}$/.test(oid)) return null
  const root = await repoOf(path)
  return root ? textAt(root, path, oid) : null
})
/** Keep a history in the file's folder: a repository, a first commit, commits on save. */
ipcMain.handle('git:start', async (_e, path: unknown) => {
  if (typeof path !== 'string') return null
  const owner = ownerFolder(path)
  if (!owner || (await repoOf(path))) return gitInfo(path)
  await startHistory(owner.dir, authorOf(owner.dir, fallbackAuthor()), 'Start the history')
  if (owner.kind === 'project') workspace.updateProject(owner.id, { autoCommit: true })
  else workspace.setSharedAutoCommit(true)
  // The first commit: the tree's statuses and branch change.
  send('git:committed', { path })
  return gitInfo(path)
})
ipcMain.handle('git:auto', async (_e, path: unknown, on: unknown) => {
  if (typeof path !== 'string' || typeof on !== 'boolean') return null
  const owner = ownerFolder(path)
  if (owner?.kind === 'project') workspace.updateProject(owner.id, { autoCommit: on })
  else if (owner?.kind === 'shared') workspace.setSharedAutoCommit(on)
  return gitInfo(path)
})
/** Who last changed each line of a file (the system git when there is one); null outside git. */
ipcMain.handle('git:blame', async (_e, path: unknown) => {
  if (typeof path !== 'string') return null
  const root = await repoOf(path)
  if (!root) return null
  return blameOf(root, path, await (systemGit ??= findSystemGit()))
})
let systemGit: Promise<string | null> | null = null

/** A file's text in the last commit (for its changes in the gutter); null outside git or for a file git does not have. */
ipcMain.handle('git:head-text', async (_e, path: unknown) => {
  if (typeof path !== 'string') return null
  const root = await repoOf(path)
  if (!root) return null
  return headText(root, path)
})

// Changes (ADR-002, I1): the repository's index and working folder, as source control shows them.
ipcMain.handle('git:changes', async (_e, path: unknown) => {
  if (typeof path !== 'string') return null
  const root = await repoOf(path)
  if (!root) return null
  return { root, branch: await branchOf(root), ...(await changesOf(root)) }
})
/** The repository's root as asked for: one folio knows of (a project's or Shared's), never any folder. */
async function changesRoot(root: unknown): Promise<string | null> {
  if (typeof root !== 'string' || !isAbsolute(root)) return null
  return (await repoOf(root)) === root && workspace.ownerOf(root) !== null ? root : null
}
const repoPaths = (paths: unknown): string[] | null =>
  Array.isArray(paths) && paths.every((p) => typeof p === 'string' && !p.split('/').includes('..')) ? (paths as string[]) : null
ipcMain.handle('git:stage', async (_e, root: unknown, paths: unknown) => {
  const dir = await changesRoot(root)
  const files = repoPaths(paths)
  if (!dir || !files) return false
  await stageFiles(dir, files)
  return true
})
ipcMain.handle('git:unstage', async (_e, root: unknown, paths: unknown) => {
  const dir = await changesRoot(root)
  const files = repoPaths(paths)
  if (!dir || !files) return false
  await unstageFiles(dir, files)
  return true
})
/** A file's changes thrown away, after asking: it cannot be undone. */
ipcMain.handle('git:discard', async (_e, root: unknown, path: unknown) => {
  const dir = await changesRoot(root)
  const files = repoPaths([path])
  if (!dir || !files || !win) return false
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [L().discardConfirm, L().cancel],
    defaultId: 1,
    cancelId: 1,
    message: L().discardQuestion.replace('{name}', basename(files[0]!)),
    detail: L().discardDetail,
  })
  if (response !== 0) return false
  await discardFile(dir, files[0]!)
  return true
})
ipcMain.handle('git:commit-staged', async (_e, root: unknown, message: unknown, amend: unknown) => {
  const dir = await changesRoot(root)
  if (!dir || typeof message !== 'string' || message.trim() === '' || mergeHead(dir)) return null
  const author = authorOf(dir, fallbackAuthor())
  // Amended: the last commit made again with what is staged (or only its message).
  const oid = amend === true ? await amendLast(dir, message.trim(), author) : await commitStaged(dir, message.trim(), author)
  if (oid) send('git:committed', { path: dir })
  return oid
})

/** Commit the file now, with a message of one's own. */
ipcMain.handle('git:commit', async (_e, path: unknown, message: unknown) => {
  if (typeof path !== 'string' || typeof message !== 'string' || message.trim() === '') return null
  const root = await repoOf(path)
  if (!root || mergeHead(root)) return null
  autoCommit.cancel(path)
  const oid = await commitFile(root, path, message.trim(), authorOf(root, fallbackAuthor()))
  if (oid) send('git:committed', { path })
  return oid
})
ipcMain.handle('git:branch-create', (_e, path: unknown, name: unknown) =>
  gitAction(path, async (root) => {
    if (typeof name !== 'string' || name.trim() === '') throw new GitError('invalid')
    await autoCommit.flush()
    await createBranch(root, name.trim())
    return { ok: true }
  }),
)
ipcMain.handle('git:branch-switch', (_e, path: unknown, name: unknown) =>
  gitAction(path, async (root) => {
    if (typeof name !== 'string') throw new GitError('invalid')
    // What waits for its commit goes with the branch it was saved on.
    await autoCommit.flush()
    await switchBranch(root, name)
    return { ok: true }
  }),
)
ipcMain.handle('git:remote', (_e, path: unknown, url: unknown) =>
  gitAction(path, async (root) => {
    if (typeof url !== 'string' || url.trim() === '') throw new GitError('invalid')
    await setRemote(root, url.trim())
    return { ok: true }
  }),
)
ipcMain.handle('git:sync', (_e, path: unknown) =>
  gitAction(path, async (root) => {
    await autoCommit.flush()
    return { ok: true, transport: (await transportOf()).kind, ...(await syncRepo(root, await transportOf(), authorOf(root, fallbackAuthor()))) }
  }),
)
/** A login for the remote's host (the built-in transport only: the system git has its own). */
ipcMain.handle('git:login', (_e, path: unknown, username: unknown, password: unknown, remember: unknown) =>
  gitAction(path, async (root) => {
    const remote = await remoteOf(root)
    if (!remote || typeof username !== 'string' || typeof password !== 'string') throw new GitError('invalid')
    return { ok: true, saved: logins.set(remote.url, { username, password }, remember === true) }
  }),
)
/** The last commit's message (to amend it). */
ipcMain.handle('git:last-message', async (_e, root: unknown) => {
  const dir = await changesRoot(root)
  return dir ? lastMessage(dir) : null
})
// Changes put aside and taken back (the system's git).
// Read only: no gitAction (it tells the window git changed, and the panel would ask again, round and round).
ipcMain.handle('git:stash-list', async (_e, path: unknown) => {
  const root = typeof path === 'string' ? await repoOf(path) : null
  if (!root) return { error: 'invalid', detail: [] }
  const bin = await (systemGit ??= findSystemGit())
  try {
    return { ok: true, available: bin !== null, list: await stashList(bin, root) }
  } catch (e) {
    return { error: 'failed', detail: [e instanceof Error ? e.message : String(e)] }
  }
})
ipcMain.handle('git:stash-push', (_e, path: unknown, message: unknown) =>
  gitAction(path, async (root) => {
    await autoCommit.flush()
    await stashPush(await (systemGit ??= findSystemGit()), root, typeof message === 'string' ? message : '', authorOf(root, fallbackAuthor()))
    send('fs:changed', [{ root: roots.register(root), dirs: [], files: [], all: true }])
    return { ok: true }
  }),
)
ipcMain.handle('git:stash-apply', (_e, path: unknown, index: unknown, pop: unknown) =>
  gitAction(path, async (root) => {
    if (typeof index !== 'number') throw new GitError('invalid')
    await stashApply(await (systemGit ??= findSystemGit()), root, index, pop === true)
    send('fs:changed', [{ root: roots.register(root), dirs: [], files: [], all: true }])
    return { ok: true }
  }),
)
ipcMain.handle('git:stash-drop', (_e, path: unknown, index: unknown) =>
  gitAction(path, async (root) => {
    if (typeof index !== 'number' || !(await confirm(L().stashDropQuestion, L().stashDropDetail, L().drop))) return { ok: false }
    await stashDrop(await (systemGit ??= findSystemGit()), root, index)
    return { ok: true }
  }),
)
/** A commit undone by a new one (asked first). */
ipcMain.handle('git:revert', (_e, path: unknown, oid: unknown, summary: unknown) =>
  gitAction(path, async (root) => {
    if (typeof oid !== 'string') throw new GitError('invalid')
    if (!(await confirm(L().revertQuestion.replace('{commit}', typeof summary === 'string' ? summary : oid.slice(0, 7)), L().revertDetail, L().revert))) return { ok: false }
    await autoCommit.flush()
    await revertCommit(await (systemGit ??= findSystemGit()), root, oid, authorOf(root, fallbackAuthor()))
    send('fs:changed', [{ root: roots.register(root), dirs: [], files: [], all: true }])
    return { ok: true }
  }),
)
ipcMain.handle('git:branch-rename', (_e, path: unknown, from: unknown, to: unknown) =>
  gitAction(path, async (root) => {
    if (typeof from !== 'string' || typeof to !== 'string' || to.trim() === '') throw new GitError('invalid')
    await renameBranch(root, from, to.trim())
    return { ok: true }
  }),
)
ipcMain.handle('git:branch-delete', (_e, path: unknown, name: unknown) =>
  gitAction(path, async (root) => {
    if (typeof name !== 'string') throw new GitError('invalid')
    if (!(await confirm(L().branchDeleteQuestion.replace('{branch}', name), L().branchDeleteDetail, L().delete))) return { ok: false }
    await deleteBranch(root, name)
    return { ok: true }
  }),
)
ipcMain.handle('git:tag-create', (_e, path: unknown, name: unknown, oid: unknown, message: unknown) =>
  gitAction(path, async (root) => {
    if (typeof name !== 'string' || typeof oid !== 'string' || name.trim() === '') throw new GitError('invalid')
    await createTag(root, name.trim(), oid, typeof message === 'string' ? message : '', authorOf(root, fallbackAuthor()))
    return { ok: true }
  }),
)
ipcMain.handle('git:tag-delete', (_e, path: unknown, name: unknown) =>
  gitAction(path, async (root) => {
    if (typeof name !== 'string') throw new GitError('invalid')
    if (!(await confirm(L().tagDeleteQuestion.replace('{tag}', name), '', L().delete))) return { ok: false }
    await deleteTag(root, name)
    return { ok: true }
  }),
)

/** A yes or no from the person, in a native dialog: true for yes. */
async function confirm(message: string, detail: string, yes: string): Promise<boolean> {
  if (!win) return false
  const { response } = await dialog.showMessageBox(win, { type: 'warning', buttons: [yes, L().cancel], defaultId: 0, cancelId: 1, message, detail })
  return response === 0
}

ipcMain.handle('git:merge-finish', (_e, path: unknown) =>
  gitAction(path, async (root) => ({ ok: true, oid: await finishMerge(root, authorOf(root, fallbackAuthor())) })),
)
ipcMain.handle('git:merge-abort', (_e, path: unknown) =>
  gitAction(path, async (root) => {
    await abortMerge(root)
    return { ok: true }
  }),
)
/** Clone a repository into a chosen folder, and add it as a project. */
ipcMain.handle('git:clone', async (_e, url: unknown) => {
  if (typeof url !== 'string' || url.trim() === '' || !win) return { error: 'invalid', detail: [] }
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: L().cloneInto })
  const parent = result.filePaths[0]
  if (result.canceled || !parent) return { error: 'canceled', detail: [] }
  const dir = cloneTarget(parent, url.trim())
  try {
    await cloneInto(await transportOf(), url.trim(), dir)
  } catch (e) {
    if (e instanceof GitError) return { error: e.code, detail: e.detail }
    return { error: 'network', detail: [e instanceof Error ? e.message : String(e)] }
  }
  const project = workspace.addProject(dir)
  workspace.updateProject(project.id, { autoCommit: true })
  send('ws:changed', workspaceView())
  return { ok: true, dir }
})

/** The status of a tree's folder: changed files by path, and the branch for the folder's top. */
ipcMain.handle('git:status', async (_e, root: unknown, rel: unknown) => {
  const top = typeof root === 'string' ? roots.dir(root) : undefined
  if (top === undefined || typeof rel !== 'string') return null
  const dir = rel === '' ? top : join(top, ...rel.split('/'))
  const repo = await repoOf(dir)
  if (!repo) return null
  const statuses = await statusUnder(repo, dir)
  return { branch: rel === '' ? await branchOf(repo) : null, files: Object.fromEntries(statuses) }
})

// PDF -------------------------------------------------------------------------------

/** What the print page lays out: the documents, their title, the options. */
interface PdfJob {
  title: string
  lang: string
  options: ReturnType<typeof pdfOptions>
  /** `urls`: the document's address from every root of the job — a link from another document is written against its own root. */
  docs: { name: string; text: string; base: string | null; format: string; urls: string[] }[]
}

/** A document's addresses as `folio://app/r/<root>/<path>`, for every root of the job that holds it. */
function addressesOf(path: string, rootIds: string[]): string[] {
  const out: string[] = []
  for (const id of rootIds) {
    const dir = roots.dir(id)
    if (!dir) continue
    const rel = relative(dir, path)
    if (rel.startsWith('..') || rel === '') continue
    out.push(`folio://app/r/${id}/${rel.split(sep).map(encodeURIComponent).join('/')}`)
  }
  return out
}
const pdfJobs = new Map<number, { job: PdfJob; ready: (ok: boolean) => void }>()

ipcMain.handle('pdf:job', (e) => pdfJobs.get(e.sender.id)?.job ?? null)
ipcMain.on('pdf:ready', (e, ok: unknown) => pdfJobs.get(e.sender.id)?.ready(ok === true))

/**
 * Lays the documents out in a hidden window of the documents' session (the
 * network consent holds there too), waits for the print page to say every
 * widget is in its print form, prints to PDF, writes the file.
 */
async function renderPdf(job: PdfJob, file: string): Promise<void> {
  const w = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1300,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  })
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    const ready = new Promise<boolean>((resolve) => {
      pdfJobs.set(w.webContents.id, { job, ready: resolve })
      setTimeout(() => resolve(false), 120_000)
    })
    await w.loadURL('folio://app/ui/print.html')
    if (!(await ready)) throw new Error('the documents did not finish drawing')
    const data = await w.webContents.printToPDF(printToPdfOptions(job.options, job.title))
    writeFileSync(file, data)
  } finally {
    pdfJobs.delete(w.webContents.id)
    w.destroy()
  }
}

/**
 * Export as PDF: one document (with its unsaved edits, as shown) or a folder
 * as one PDF. Asks where to save; resolves with the file, or why not.
 */
ipcMain.handle('pdf:export', async (_e, target: unknown, rawOptions: unknown) => {
  if (!win || !target || typeof target !== 'object') return { error: 'invalid' }
  const t = target as { kind?: string; path?: unknown; text?: unknown; name?: unknown; dir?: unknown; slides?: unknown }
  // A note as slides: pages of its own shape, whatever the dialog last chose.
  const options = t.slides === true && t.kind === 'doc' ? SLIDES_PDF : pdfOptions(rawOptions)
  const opened = (files: string[]) => {
    const list = files.map(open).filter((o): o is OpenedDocument => !('error' in o))
    const ids = [...new Set(list.map((o) => o.root))]
    return list.map((o) => ({ name: o.name, text: o.text, base: o.base, format: o.format, urls: addressesOf(o.path, ids) }))
  }
  let docs: PdfJob['docs']
  let title: string
  let where: string
  if (t.kind === 'folder' && typeof t.dir === 'string' && existsSync(t.dir)) {
    docs = opened(folderDocuments(t.dir))
    title = basename(t.dir)
    where = join(dirname(t.dir), pdfName(t.dir))
  } else if (t.kind === 'doc' && (typeof t.text === 'string' || typeof t.path === 'string')) {
    const doc = typeof t.path === 'string' ? (opened([t.path])[0] ?? null) : null
    const name = doc?.name ?? (typeof t.name === 'string' && t.name.trim() ? t.name.trim() : 'note')
    // The text as shown (unsaved edits too), else the file's.
    const text = typeof t.text === 'string' ? t.text : (doc?.text ?? '')
    docs = [doc ? { ...doc, text } : { name, text, base: null, format: 'markdown', urls: [] }]
    title = name.replace(/\.[^.]+$/, '')
    where = join(typeof t.path === 'string' ? dirname(t.path) : workspace.shared(), pdfName(name))
  } else return { error: 'invalid' }
  if (docs.length === 0) return { error: 'empty' }
  const result = await dialog.showSaveDialog(win, { defaultPath: where, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    await renderPdf({ title, lang: app.getLocale().startsWith('ru') ? 'ru' : 'en', options, docs }, result.filePath)
    return { saved: result.filePath }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('app:startup', () => {
  const fromArgv = filesFromArgv(process.argv, process.cwd())
  type Restored = { doc: Opened | null; buffer: Buffer | null; conflict: boolean }
  const restore = (path: string | null, bufferId: string | null): Restored | null => {
    const buffer = bufferId ? buffers.get(bufferId) : null
    if (path === null && buffer === null) return null
    const filePath = path ?? buffer?.path ?? null
    if (filePath !== null && buffer === null && !existsSync(filePath)) return null
    const doc = filePath !== null ? open(filePath) : null
    // The file changed while the edit waited: both versions stay, nothing is overwritten.
    const conflict = !!buffer && !!doc && !('error' in doc) && buffer.baseline !== null && hashText(doc.text) !== buffer.baseline
    return { doc, buffer, conflict }
  }
  const tabs: Restored[] = []
  for (const t of session.tabs()) {
    const r = restore(t.path, t.buffer)
    if (r) tabs.push(r)
  }
  // A buffer the session does not name (the session write was lost) still comes back: notes are never dropped.
  const named = new Set(tabs.map((t) => t.buffer?.id).filter(Boolean))
  for (const b of buffers.all()) if (!named.has(b.id)) tabs.push(restore(b.path, b.id)!)
  let active = session.active()
  for (const path of fromArgv) {
    const at = tabs.findIndex((t) => t.doc && !('error' in t.doc) && t.doc.path === path)
    if (at >= 0) active = at
    else {
      tabs.push({ doc: open(path), buffer: null, conflict: false })
      active = tabs.length - 1
    }
  }
  return { tabs, active, locale: app.getLocale(), shared: workspace.shared() }
})
ipcMain.handle('doc:open-dialog', () => openDialog())
ipcMain.handle('doc:open', (_e, path: unknown) => (typeof path === 'string' ? open(path) : { error: 'Not a path', path: '' }))
ipcMain.handle('doc:open-url', (_e, url: unknown) => {
  const file = typeof url === 'string' ? documentOfUrl(url, roots) : null
  return file === null ? { error: 'Not a file of this folder', path: String(url) } : open(file)
})
ipcMain.on('link:external', (_e, url: unknown) => {
  if (typeof url === 'string' && (/^https?:\/\//.test(url) || url.startsWith('mailto:'))) void shell.openExternal(url)
})
ipcMain.on('doc:state', (_e, tabs: unknown, active: unknown, activePath: unknown) => {
  const list = Array.isArray(tabs)
    ? tabs
        .filter((t): t is { path: unknown; buffer: unknown } => typeof t === 'object' && t !== null)
        .map((t) => ({ path: typeof t.path === 'string' ? t.path : null, buffer: typeof t.buffer === 'string' ? t.buffer : null }))
    : []
  gate?.setActive(typeof activePath === 'string' ? activePath : null)
  session.set(list, typeof active === 'number' ? active : null)
})

// Editing ---------------------------------------------------------------------

ipcMain.handle('buf:new-id', () => newBufferId())
ipcMain.on('buf:write', (_e, value: unknown) => {
  const b = value as Partial<Buffer>
  if (typeof b?.id !== 'string' || typeof b.text !== 'string') return
  const mode = b.mode === 'source' || b.mode === 'split' ? b.mode : 'visual'
  buffers.write({
    id: b.id,
    path: typeof b.path === 'string' ? b.path : null,
    text: b.text,
    baseline: typeof b.baseline === 'string' ? b.baseline : null,
    mode,
    scroll: typeof b.scroll === 'number' ? b.scroll : 0,
    updatedAt: '',
  })
})
ipcMain.on('buf:drop', (_e, id: unknown) => {
  if (typeof id === 'string') buffers.remove(id)
})
/** The file's text on disk and its hash; null when it is gone. */
/**
 * The `.editorconfig` files on the way up from a file, by their directory —
 * up to one that says `root = true`, or the top of the disk. Only files of
 * that name are read.
 */
ipcMain.handle('doc:editorconfig', (_e, path: unknown) => {
  if (typeof path !== 'string' || !isAbsolute(path)) return {}
  const out: Record<string, string> = {}
  let dir = dirname(path)
  for (let i = 0; i < 64; i++) {
    try {
      const text = readFileSync(join(dir, '.editorconfig'), 'utf8')
      out[dir] = text
      if (/^\s*root\s*=\s*true\s*$/im.test(text.split(/^\s*\[/m)[0] ?? '')) break
    } catch {
      /* none here */
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return out
})

ipcMain.handle('doc:disk', (_e, path: unknown) => {
  // A picture or a video is not text: never read whole as one.
  if (typeof path !== 'string' || isMedia(formatByName(path))) return null
  try {
    const text = readFileSync(path, 'utf8')
    return { text, hash: hashText(text) }
  } catch {
    return null
  }
})
ipcMain.handle('doc:hash', (_e, text: unknown) => (typeof text === 'string' ? hashText(text) : null))

function writeDocument(path: string, text: string): Opened {
  writeFileSync(path, text)
  // Its folder keeps a history: the save goes into it after a pause.
  if (workspace.autoCommits(path)) autoCommit.saved(path)
  return open(path)
}

/**
 * Save to the file: refused (conflict) when the file changed on disk since the
 * edit began and is not already what is being saved — unless forced.
 */
ipcMain.handle('doc:save', (_e, path: unknown, text: unknown, baseline: unknown, force: unknown) => {
  if (typeof path !== 'string' || typeof text !== 'string') return { error: 'Nothing to save' }
  if (force !== true && existsSync(path)) {
    const disk = readFileSync(path, 'utf8')
    if (disk !== text && typeof baseline === 'string' && hashText(disk) !== baseline) return { conflict: true }
  }
  try {
    return { saved: writeDocument(path, text), baseline: hashText(text) }
  } catch (e) {
    return { error: String(e) }
  }
})
ipcMain.handle('doc:save-as', async (_e, text: unknown, name: unknown, dir: unknown) => {
  if (!win || typeof text !== 'string') return { canceled: true }
  const folder = typeof dir === 'string' && existsSync(dir) ? dir : workspace.shared()
  const suggested = (typeof name === 'string' && name.trim() !== '' ? name.trim() : 'note').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)
  // A file keeps its kind (order.bpmn stays BPMN); a note becomes Markdown.
  const ext = extname(suggested).slice(1)
  const result = await dialog.showSaveDialog(win, {
    defaultPath: join(folder, ext ? suggested : `${suggested}.md`),
    filters: ext && ext !== 'md' ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: L().allFiles, extensions: ['*'] }] : [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    return { saved: writeDocument(result.filePath, text), baseline: hashText(text) }
  } catch (e) {
    return { error: String(e) }
  }
})
/** Closing a tab with unsaved changes: save, drop them, or keep the tab. */
ipcMain.handle('doc:confirm-close', async (_e, name: unknown) => {
  if (!win) return 'cancel'
  const t = L()
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: [t.save, t.dontSave, t.cancel],
    defaultId: 0,
    cancelId: 2,
    message: t.unsavedQuestion.replace('{name}', typeof name === 'string' ? name : ''),
    detail: t.unsavedDetail,
  })
  return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
})
ipcMain.handle('net:allow', (_e, scope: unknown, path: unknown) => {
  if ((scope !== 'file' && scope !== 'folder') || typeof path !== 'string') return false
  consent.allow(scope, path)
  return true
})

app.on('second-instance', (_event, argv, cwd) => {
  openInWindow(filesFromArgv(argv, cwd))
})

// macOS: a file dropped on the Dock icon or opened with folio.
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (app.isReady() && win) openInWindow([path])
})

// Leaving: what waits for a commit is committed first.
let committedOnQuit = false
app.on('before-quit', (event) => {
  if (committedOnQuit || autoCommit.pending().length === 0) return
  event.preventDefault()
  committedOnQuit = true
  void autoCommit.flush().finally(() => app.quit())
})

app.on('will-quit', () => {
  watcher.close()
  void lsp.stopAll()
  // A downloaded version takes the program's place; only a packaged one has a place to take.
  if (!app.isPackaged) return
  const result = updater.apply(process.pid)
  if (result.relaunch) app.relaunch(result.execPath ? { execPath: result.execPath, args: [] } : undefined)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
})

/** Run by the e2e tests: out of the way of the person at the machine. */
const underTest = process.env.FOLIO_E2E === '1'
if (underTest && process.platform === 'darwin') {
  // A test closes the app mid-flight; macOS would offer to reopen its windows next time (the development Electron's defaults only).
  systemPreferences.setUserDefault('ApplePersistenceIgnoreState', 'boolean', true)
}

void app.whenReady().then(() => {
  // No Dock icon for the tests' windows.
  if (underTest) app.dock?.hide()
  // Run from the source on a Mac: the Dock shows folio's icon, not Electron's.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(__dirname, 'icon.png'))
  const docs = electronSession.fromPartition(PARTITION)
  handleScheme(docs, join(__dirname, 'renderer'), roots)
  gate = gateNetwork(docs, (file) => consent.allows(file), (document, hosts) => send('net:blocked', { document, hosts }))
  buildMenu()
  win = createWindow()
  updater.tidy()
  // Once a day at start, a while after the window is up; a source checkout (no release to replace) never looks.
  if ((app.isPackaged || process.env.FOLIO_UPDATE_URL) && workspace.updates() && updater.due()) setTimeout(() => void updater.check(), 10_000)
})
