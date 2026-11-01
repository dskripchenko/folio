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
import { Workspace } from './workspace'

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
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => void openDialog().then((docs) => docs.forEach((d) => send('doc:opened', d))) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('menu:close-tab') },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
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
