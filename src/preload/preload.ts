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
  state: (tabs: { path: string | null; buffer: string | null }[], active: number | null, activePath: string | null) =>
    ipcRenderer.send('doc:state', tabs, active, activePath),
  newBufferId: () => ipcRenderer.invoke('buf:new-id'),
  writeBuffer: (buffer: Record<string, unknown>) => ipcRenderer.send('buf:write', buffer),
  dropBuffer: (id: string) => ipcRenderer.send('buf:drop', id),
  disk: (path: string) => ipcRenderer.invoke('doc:disk', path),
  hash: (text: string) => ipcRenderer.invoke('doc:hash', text),
  save: (path: string, text: string, baseline: string | null, force: boolean) => ipcRenderer.invoke('doc:save', path, text, baseline, force),
  saveAs: (text: string, name: string, dir: string | null) => ipcRenderer.invoke('doc:save-as', text, name, dir),
  confirmClose: (name: string) => ipcRenderer.invoke('doc:confirm-close', name),
  onNewNote: listen('menu:new-note'),
  onSave: listen('menu:save'),
  onSaveAs: listen('menu:save-as'),
  onToggleEdit: listen('menu:toggle-edit'),
  allowNetwork: (scope: 'file' | 'folder', path: string) => ipcRenderer.invoke('net:allow', scope, path),
  workspace: () => ipcRenderer.invoke('ws:get'),
  addProject: () => ipcRenderer.invoke('ws:add-project'),
  updateProject: (id: string, changes: Record<string, unknown>) => ipcRenderer.invoke('ws:update-project', id, changes),
  setShared: (reset: boolean) => ipcRenderer.invoke('ws:set-shared', reset),
  projectMenu: (id: string) => ipcRenderer.send('ws:project-menu', id),
  list: (root: string, rel: string, all: boolean) => ipcRenderer.invoke('tree:list', root, rel, all),
  openEntry: (root: string, rel: string) => ipcRenderer.invoke('tree:open', root, rel),
  entryMenu: (root: string, rel: string) => ipcRenderer.send('tree:menu', root, rel),
  onWorkspace: listen('ws:changed'),
  onEdit: listen('ws:edit'),
  onFsChanged: listen('fs:changed'),
  onAddProject: listen('menu:add-project'),
  onToggleSidebar: listen('menu:toggle-sidebar'),
  onOpened: listen('doc:opened'),
  onBlocked: listen('net:blocked'),
  onCloseTab: listen('menu:close-tab'),
})
