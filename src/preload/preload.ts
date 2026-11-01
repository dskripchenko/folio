import { contextBridge } from 'electron'

/**
 * The only bridge between a document's window and the rest: what it may ask
 * for, and nothing else. Grows with the stages (open, save, files of the
 * project) — never a general `require`.
 */
contextBridge.exposeInMainWorld('folio', {
  platform: process.platform,
})
