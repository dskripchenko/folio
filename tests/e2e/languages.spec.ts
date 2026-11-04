import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

/** The labels of the app menu's items (File, Edit… and what is under them), as the main process built it. */
const menuLabels = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).flatMap((i) => [i.label, ...(i.submenu?.items ?? []).map((s) => s.label)]))

test('languages: chosen in the settings menu, at once in the window and the menus, kept; one of one’s own from folio-data/locales', async () => {
  const f = fixture()
  // A language of one's own: what it leaves out is English.
  mkdirSync(join(f.data, 'locales'), { recursive: true })
  writeFileSync(join(f.data, 'locales', 'de.json'), JSON.stringify({ meta: { code: 'de', name: 'Deutsch' }, main: { newNote: 'Neue Notiz' }, window: { commands: { placeholder: 'Befehl eingeben' } } }))
  let app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    let win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    const choose = async (testid: string) => {
      await win.getByTestId('rail-settings').click()
      await win.getByTestId(testid).click()
    }
    const palettePlaceholder = async () => {
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
      const p = await win.getByTestId('command-input').getAttribute('placeholder')
      await win.keyboard.press('Escape')
      return p
    }

    await choose('language-ru')
    await expect.poll(palettePlaceholder).toBe('Введите команду')
    expect(await win.evaluate(() => document.documentElement.lang)).toBe('ru')
    await expect.poll(() => menuLabels(app)).toContain('Новая заметка')

    await choose('language-en')
    await expect.poll(palettePlaceholder).toBe('Type a command')
    await expect.poll(() => menuLabels(app)).toContain('New Note')

    // One's own: its words where it has them, English for the rest.
    await choose('language-de')
    await expect.poll(palettePlaceholder).toBe('Befehl eingeben')
    await expect.poll(() => menuLabels(app)).toContain('Neue Notiz')
    expect(await menuLabels(app)).toContain('Open…')

    // Kept across a restart.
    await app.close()
    app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
    win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    expect(await win.evaluate(() => document.documentElement.lang)).toBe('de')
    // Back to the system's.
    await choose('language-system')
    await expect.poll(() => win.evaluate(() => document.documentElement.lang)).not.toBe('de')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
