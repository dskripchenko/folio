import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const samples = join(import.meta.dirname, '..', 'fixtures', 'diagrams')

async function addProject(app: ElectronApplication, win: Page, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
  }, [dir])
  await win.getByTestId('add-project').click()
  await win.getByTestId('add-folder').click()
}

test('diagram files and API descriptions open directly, drawn by their elements, edited where they can be', async () => {
  const f = fixture()
  const proj = join(f.root, 'arch')
  mkdirSync(proj)
  for (const name of ['order.bpmn', 'loan.dmn', 'architecture.drawio']) copyFileSync(join(samples, name), join(proj, name))
  writeFileSync(join(proj, 'flow.mmd'), 'flowchart LR\n  Draft --> Review\n')
  writeFileSync(join(proj, 'api.yaml'), 'openapi: 3.1.0\ninfo:\n  title: Orders API\n  version: 1.0.0\npaths:\n  /orders:\n    get:\n      operationId: listOrders\n      summary: List the orders\n      responses:\n        "200":\n          description: OK\n')
  writeFileSync(join(proj, 'events.yaml'), 'asyncapi: 3.0.0\ninfo:\n  title: Order events\n  version: 1.0.0\nchannels:\n  orders:\n    address: orders\n')
  writeFileSync(join(proj, 'package.json'), '{}\n')
  writeFileSync(join(proj, 'index.md'), '# Architecture\n\nThe [order process](order.bpmn).\n')

  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('shared')).toBeVisible()
    await addProject(app, win, proj)
    const project = win.getByTestId('projects').locator('.project', { hasText: 'arch' })
    await project.locator('.project-row').click()
    const tree = project.locator('.tree')
    for (const name of ['order.bpmn', 'loan.dmn', 'architecture.drawio', 'flow.mmd', 'api.yaml', 'events.yaml', 'index.md']) await expect(tree.locator('.row', { hasText: name })).toBeVisible()
    // Other JSON is listed as code (shown highlighted), not as an API description.
    await expect(tree.locator('.row.kind-code', { hasText: 'package.json' })).toBeVisible()
    const doc = win.locator('article.doc:not([hidden])')
    const open = (name: string) => tree.locator('.row', { hasText: name }).click()

    // A link in a document opens the diagram in a tab of its own.
    await open('index.md')
    await doc.getByRole('link', { name: 'order process' }).click()
    await expect(win.getByRole('tab', { name: /order\.bpmn/ })).toHaveAttribute('aria-selected', 'true')
    await expect(doc).toHaveAttribute('data-format', 'bpmn')
    await expect(doc.locator('dsk-bpmn svg').first()).toBeVisible({ timeout: 15_000 })
    await expect(win.getByTestId('mode')).toBeEnabled()

    // Edited in the BPMN editor: a task removed, the tab edited, the file changed on Save.
    await viewMode(win, 'visual')
    const task = doc.locator('dsk-bpmn[editable] [data-element-id="Task_Reject"]').first()
    await task.click()
    await win.keyboard.press('Delete')
    await expect(win.getByRole('tab', { name: /order\.bpmn/ })).toHaveClass(/dirty/)
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /order\.bpmn/ })).not.toHaveClass(/dirty/)
    expect(readFileSync(join(proj, 'order.bpmn'), 'utf8')).not.toContain('id="Task_Reject"')
    expect(readFileSync(join(proj, 'order.bpmn'), 'utf8')).toContain('id="Task_Check"')

    await open('loan.dmn')
    await expect(doc.locator('dsk-dmn svg').first()).toBeVisible({ timeout: 15_000 })

    // draw.io: drawn, not edited.
    await open('architecture.drawio')
    await expect(doc.locator('dsk-drawio svg').first()).toBeVisible({ timeout: 15_000 })
    await expect(win.getByTestId('mode')).toBeDisabled()

    await open('events.yaml')
    await expect(doc).toHaveAttribute('data-format', 'asyncapi')
    await expect(doc.locator('dsk-asyncapi')).toContainText('Order events', { timeout: 15_000 })

    await open('api.yaml')
    await expect(doc).toHaveAttribute('data-format', 'openapi')
    await expect(doc.locator('dsk-openapi')).toContainText('List the orders', { timeout: 15_000 })
    // No server in the spec: samples name localhost, never folio's own address.
    await expect(doc.locator('dsk-openapi')).toContainText('http://localhost/orders')
    await expect(doc.locator('dsk-openapi')).not.toContainText('folio://')
    await viewMode(win, 'visual')
    await expect(doc.locator('dsk-openapi[mode="editor"]')).toBeVisible()
    await viewMode(win, 'read')

    // A text notation: the source beside a live preview; saved as text.
    await open('flow.mmd')
    await expect(doc.locator('dsk-diagram svg.dg')).toContainText('Review', { timeout: 15_000 })
    await viewMode(win, 'visual')
    const source = doc.getByTestId('source')
    // The code editor: its text, the key presses into it.
    await expect.poll(() => source.locator('.dsk-code-editor').evaluate((el) => (el.closest(".source-editor") as HTMLElement & { folioEditor: { value: string } }).folioEditor.value)).toBe('flowchart LR\n  Draft --> Review\n')
    await source.locator('.dsk-code-editor__content').click()
    await win.keyboard.press(`${mod}+End`)
    await win.keyboard.type('  Review --> Published')
    // Enter keeps the indent on the new line; Backspace takes it back.
    await win.keyboard.press('Enter')
    await win.keyboard.press('Backspace')
    await expect(doc.getByTestId('preview').locator('svg.dg')).toContainText('Published')
    await expect(win.getByRole('tab', { name: /flow\.mmd/ })).toHaveClass(/dirty/)
    await win.keyboard.press(`${mod}+s`)
    await expect(win.getByRole('tab', { name: /flow\.mmd/ })).not.toHaveClass(/dirty/)
    expect(readFileSync(join(proj, 'flow.mmd'), 'utf8')).toBe('flowchart LR\n  Draft --> Review\n  Review --> Published\n')
  } finally {
    await app.close().catch(() => {})
    rmSync(f.root, { recursive: true, force: true })
  }
})
