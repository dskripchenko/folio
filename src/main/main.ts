import { app, BrowserWindow, dialog, ipcMain, Menu, session as electronSession, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Buffers, hashText, newBufferId, type Buffer } from './buffers'
import { Consent } from './consent'
import { dataDir } from './dataDir'
import { documentOfUrl, DocumentError, filesFromArgv, MARKDOWN, openDocument, type OpenedDocument } from './documents'
import { gateNetwork, type NetworkGate } from './network'
import { handleScheme, registerScheme } from './protocol'
import { Roots } from './roots'
import { Session } from './session'
import { labels } from './i18n'
import { listDir } from './tree'
import { Watcher } from './watcher'
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
let gate: NetworkGate | null = null
/** Native menus speak the system's language; known once the app is ready. */
const L = () => labels(app.isReady() ? app.getLocale() : 'en')
const watcher = new Watcher((changes) => send('fs:changed', changes))
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
    filters: [{ name: 'Markdown', extensions: MARKDOWN.map((e) => e.slice(1)) }, { name: 'All files', extensions: ['*'] }],
  })
  return result.canceled ? [] : result.filePaths.map(open)
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'folio',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  w.once('ready-to-show', () => w.show())
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
        { label: L().addProject, click: () => send('menu:add-project') },
        { label: L().save, accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => send('menu:save') },
        { label: L().saveAs, accelerator: 'CmdOrCtrl+Shift+S', registerAccelerator: false, click: () => send('menu:save-as') },
        { label: L().closeTab, accelerator: 'CmdOrCtrl+W', registerAccelerator: false, click: () => send('menu:close-tab') },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: L().view,
      submenu: [
        { label: L().toggleEdit, accelerator: 'CmdOrCtrl+E', registerAccelerator: false, click: () => send('menu:toggle-edit') },
        { label: L().toggleSidebar, accelerator: 'CmdOrCtrl+B', registerAccelerator: false, click: () => send('menu:toggle-sidebar') },
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
  }
}

function workspaceChanged(): void {
  send('ws:changed', workspaceView())
}

ipcMain.handle('ws:get', () => workspaceView())
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
  return dir === undefined || typeof rel !== 'string' ? null : listDir(dir, rel, all === true)
})
ipcMain.handle('tree:open', (_e, root: unknown, rel: unknown) => {
  const file = typeof root === 'string' && typeof rel === 'string' ? roots.resolve(root, rel) : null
  return file === null ? { error: 'Not a file of this folder', path: String(rel) } : open(file)
})
ipcMain.on('tree:menu', (_e, root: unknown, rel: unknown) => {
  const file = typeof root === 'string' && typeof rel === 'string' ? roots.resolve(root, rel) : null
  if (file === null || !win) return
  Menu.buildFromTemplate([{ label: L().reveal, click: () => shell.showItemInFolder(file) }]).popup({ window: win })
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

ipcMain.handle('app:startup', () => {
  const fromArgv = filesFromArgv(process.argv, app.isPackaged, process.cwd())
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
ipcMain.handle('doc:disk', (_e, path: unknown) => {
  if (typeof path !== 'string') return null
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
  const result = await dialog.showSaveDialog(win, {
    defaultPath: join(folder, suggested.endsWith('.md') ? suggested : `${suggested}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
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
  openInWindow(filesFromArgv(argv, app.isPackaged, cwd))
})

// macOS: a file dropped on the Dock icon or opened with folio.
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (app.isReady() && win) openInWindow([path])
})

app.on('will-quit', () => watcher.close())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
})

void app.whenReady().then(() => {
  const docs = electronSession.fromPartition(PARTITION)
  handleScheme(docs, join(__dirname, 'renderer'), roots)
  gate = gateNetwork(docs, (file) => consent.allows(file), (document, hosts) => send('net:blocked', { document, hosts }))
  buildMenu()
  win = createWindow()
})
