import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './fixture'

const pad = (n: number) => String(n).padStart(2, '0')
const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

test('the tasks panel: open tasks by when they are due, checked from the panel into the note, a task opening its note', async () => {
  const f = fixture()
  const proj = join(f.root, 'garden')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'Plan.md'), `# Plan\n\n- [ ] Late one 📅 ${day(-2)}\n- [ ] For today @${day(0)}\n- [x] Done already\n`)
  writeFileSync(join(proj, 'Ideas.md'), `# Ideas\n\n- [ ] Some day\n- [ ] Next week due:${day(7)}\n`)
  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, [proj])
    await win.getByTestId('add-project').click()
    await win.getByTestId('add-folder').click()
    const project = win.getByTestId('projects').locator('.project', { hasText: 'garden' })
    await project.locator('.project-row').click()
    await project.locator('.tree .row', { hasText: 'Plan.md' }).click()

    await win.getByTestId('toggle-tasks').click()
    const panel = win.getByTestId('tasks-panel')
    await expect(panel.getByTestId('tasks-overdue').locator('.tasks-text')).toHaveText(['Late one'])
    await expect(panel.getByTestId('tasks-today').locator('.tasks-text')).toHaveText(['For today'])
    await expect(panel.getByTestId('tasks-later').locator('.tasks-text')).toHaveText(['Next week'])
    await expect(panel.getByTestId('tasks-noDate').locator('.tasks-text')).toHaveText(['Some day'])
    await expect(panel.getByTestId('tasks-done')).toHaveCount(0)

    // Checked from the panel: the note changes, the task goes to Done.
    await panel.getByTestId('tasks-today').locator('input').click()
    await expect.poll(() => readFileSync(join(proj, 'Plan.md'), 'utf8')).toContain(`- [x] For today @${day(0)}`)
    await expect(panel.getByTestId('tasks-today')).toHaveCount(0)
    await panel.getByTestId('tasks-all').click()
    await expect(panel.getByTestId('tasks-done').locator('.tasks-text')).toHaveText(['Done already', 'For today'])

    // A task's text: its note opens.
    await panel.locator('.tasks-text', { hasText: 'Some day' }).click()
    await expect(win.getByRole('tab', { name: /Ideas\.md/ })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await app.close()
  }
})
