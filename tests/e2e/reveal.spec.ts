import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

test('a tab shows its file in the tree: the project found, its folders opened, the row in view; in the flyout when the sidebar is folded', async () => {
  const f = fixture()
  const proj = join(f.root, 'app')
  mkdirSync(join(proj, 'src', 'deep'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), '{ "name": "app" }\n')
  writeFileSync(join(proj, 'src', 'deep', 'main.ts'), 'export const a = 1\n')
  const file = join(proj, 'src', 'deep', 'main.ts')
  const app = await electron.launch({ args: ['.', file], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const tab = win.getByRole('tab', { name: /main\.ts/ })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    // The file is under no project yet: its tree cannot show it. The project added, it can.
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'app' })
    await expect(project).toBeVisible()
    await expect(project.locator('.tree')).toHaveCount(0)

    await tab.click({ button: 'right' })
    await win.getByTestId('tab-reveal').click()
    const row = project.locator('.row[data-rel="src/deep/main.ts"]')
    await expect(row).toBeVisible()
    await expect(row).toBeFocused()
    await expect(row).toHaveClass(/active/)
    await expect(project.locator('.row[data-rel="src"]')).toHaveClass(/open/)

    // The sidebar folded: the project's tree slides out with the row in it.
    await win.getByTestId('side-collapse').click()
    await expect(win.getByTestId('projects')).toBeHidden()
    await tab.click({ button: 'right' })
    await win.getByTestId('tab-reveal').click()
    const flyRow = win.locator('.flyout .row[data-rel="src/deep/main.ts"]')
    await expect(flyRow).toBeVisible()
    await expect(flyRow).toBeFocused()
  } finally {
    await app.close()
  }
})
