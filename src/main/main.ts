import { app, BrowserWindow, dialog, ipcMain, Menu, session as electronSession, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
    return openDocument(path, workspace, roots)
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
        { label: L().open, accelerator: 'CmdOrCtrl+O', click: () => void openDialog().then((docs) => docs.forEach((d) => send('doc:opened', d))) },
        { label: L().addProject, click: () => send('menu:add-project') },
        { label: L().closeTab, accelerator: 'CmdOrCtrl+W', click: () => send('menu:close-tab') },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: L().view,
      submenu: [
        { label: L().toggleSidebar, accelerator: 'CmdOrCtrl+B', click: () => send('menu:toggle-sidebar') },
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
  const paths = fromArgv.length > 0 ? fromArgv : session.documents().filter((p) => existsSync(p))
  const documents = paths.map(open)
  const active = fromArgv.length > 0 ? (fromArgv[fromArgv.length - 1] ?? null) : session.active()
  return { documents, active, locale: app.getLocale() }
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
ipcMain.on('doc:state', (_e, documents: unknown, active: unknown) => {
  const list = Array.isArray(documents) ? documents.filter((d): d is string => typeof d === 'string') : []
  const current = typeof active === 'string' ? active : null
  gate?.setActive(current)
  session.set(list, current)
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
