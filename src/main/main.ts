import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { dataDir } from './dataDir'

// Before anything reads it: settings, caches and session data live beside the program.
const data = dataDir({ env: process.env, platform: process.platform, execPath: process.execPath, packaged: app.isPackaged, cwd: process.cwd() })
app.setPath('userData', data)
app.setPath('sessionData', join(data, 'session'))
app.setPath('logs', join(data, 'logs'))
app.setPath('crashDumps', join(data, 'crashes'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'folio',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  // Links leave the app for the system browser; the window never navigates away from folio.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
  void win.loadFile(join(__dirname, 'renderer', 'index.html'))
  return win
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

void app.whenReady().then(() => {
  createWindow()
})
