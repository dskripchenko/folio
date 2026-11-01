import { contextBridge, ipcRenderer, webUtils } from 'electron'

/**
 * The only bridge between a document's window and the rest: what it may ask
 * for, and nothing else — never a general `require` or `ipcRenderer`.
 */
const listen = (channel: string) => (callback: (value: unknown) => void) => {
  const handler = (_event: unknown, value: unknown) => callback(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('folio', {
  platform: process.platform,
  startup: () => ipcRenderer.invoke('app:startup'),
  openDialog: () => ipcRenderer.invoke('doc:open-dialog'),
  open: (path: string) => ipcRenderer.invoke('doc:open', path),
  openUrl: (url: string) => ipcRenderer.invoke('doc:open-url', url),
  /** A web or mail link, to the system's browser or mail program. */
  external: (url: string) => ipcRenderer.send('link:external', url),
  /** The path of a file dropped on the window. */
  pathOf: (file: File) => webUtils.getPathForFile(file),
  state: (documents: string[], active: string | null) => ipcRenderer.send('doc:state', documents, active),
  allowNetwork: (scope: 'file' | 'folder', path: string) => ipcRenderer.invoke('net:allow', scope, path),
  onOpened: listen('doc:opened'),
  onBlocked: listen('net:blocked'),
  onCloseTab: listen('menu:close-tab'),
})
