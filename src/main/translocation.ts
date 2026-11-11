import { app, dialog } from 'electron'
import { BUILT_IN, chooseLanguage } from '../common/i18n'

/**
 * macOS started folio from a read-only copy: it asks to be moved to
 * Applications — Electron moves it, clears the quarantine and starts it
 * again from there — or quits saying how to start it otherwise.
 */
export async function offerMove(): Promise<void> {
  await app.whenReady()
  const t = BUILT_IN[chooseLanguage(null, app.getLocale(), Object.keys(BUILT_IN))]!.main
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: t.translocatedQuestion,
    detail: t.translocatedDetail,
    buttons: [t.moveToApplications, t.quit],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    try {
      if (app.moveToApplicationsFolder()) return
    } catch (e) {
      dialog.showErrorBox(t.translocatedQuestion, `${t.moveFailed}\n\n${e instanceof Error ? e.message : String(e)}`)
    }
  }
  app.quit()
}
