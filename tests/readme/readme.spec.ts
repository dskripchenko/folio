import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from '../e2e/fixture'
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * The README's screenshots (docs/images): a small project with an agent's
 * edits, a worktree, a note with a diagram and a task list, taken in English
 * at 1440×900. Run by `pnpm readme:shots`, which then shrinks them.
 */
const OUT = process.env.FOLIO_SHOTS ?? join(process.cwd(), 'test-results', 'readme')
test('the README screenshots', async () => {
  test.setTimeout(180_000)
  const f = fixture()
  const proj = join(f.root, 'shop')
  mkdirSync(join(proj, 'src'), { recursive: true })
  mkdirSync(join(proj, 'docs'), { recursive: true })
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=Dana', '-c', 'user.email=dana@example.com', ...a], { cwd, encoding: 'utf8' })
  const cart = ['import { Item } from "./item"', '', '/** The items chosen, and what they cost together. */', 'export class Cart {', '  private items: Item[] = []', '', '  add(item: Item): void {', '    this.items.push(item)', '  }', '', '  total(): number {', '    let sum = 0', '    for (const i of this.items) sum += i.price * i.count', '    return sum', '  }', '', '  clear(): void {', '    this.items = []', '  }', '}', ''].join('\n')
  writeFileSync(join(proj, 'package.json'), '{\n  "name": "shop",\n  "private": true,\n  "scripts": { "test": "vitest run" }\n}\n')
  writeFileSync(join(proj, 'src', 'cart.ts'), cart)
  writeFileSync(join(proj, 'src', 'item.ts'), 'export interface Item {\n  name: string\n  price: number\n  count: number\n}\n')
  writeFileSync(join(proj, 'README.md'), '# Shop\n\nA small shop.\n')
  writeFileSync(join(proj, 'docs', 'checkout.md'), '# Checkout\n\nHow an order is paid.\n\n```mermaid\nsequenceDiagram\n  participant C as Customer\n  participant S as Shop\n  participant P as Payments\n  C->>S: Place the order\n  S->>P: Charge the card\n  P-->>S: Paid\n  S-->>C: Receipt\n```\n\n| Step | Who | Takes |\n|---|---|---|\n| Order | Customer | 1 min |\n| Charge | Payments | 2 s |\n| Receipt | Shop | at once |\n\n- [x] Cart\n- [x] Discounts\n- [ ] Refunds\n\n> A refund goes back the same way, from **Payments** to the card.\n')
  writeFileSync(join(proj, '.gitignore'), '.claude/\nnode_modules/\n')
  // A language server of the project's own (folio asks before running it).
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', '-D', 'typescript@5', 'typescript-language-server@4'], { cwd: proj, stdio: 'ignore' })
  git(proj, 'init', '-q', '--initial-branch=main')
  git(proj, 'config', 'core.autocrlf', 'false')
  git(proj, 'add', '.')
  git(proj, 'commit', '-qm', 'The shop: a cart')
  const wt = join(proj, '.claude', 'worktrees', 'tests-agent')
  git(proj, 'worktree', 'add', '-q', '-b', 'agent/tests', wt)
  writeFileSync(join(wt, 'src', 'cart.test.ts'), 'import { describe, expect, it } from "vitest"\nimport { Cart } from "./cart"\n\ndescribe("the cart", () => {\n  it("is empty at first", () => {\n    expect(new Cart().total()).toBe(0)\n  })\n  it("adds the prices up", () => {\n    const cart = new Cart()\n    cart.add({ name: "Tea", price: 3, count: 2 })\n    expect(cart.total()).toBe(6)\n  })\n})\n')
  git(wt, 'add', '.')
  git(wt, 'commit', '-qm', 'Tests for the cart')
  writeFileSync(join(wt, 'README.md'), '# Shop\n\nA small shop, tested.\n')
  // The main agent's edits.
  writeFileSync(join(proj, 'src', 'cart.ts'), cart.replace('i.price * i.count', 'i.price * i.quantity').replace('  clear(): void {\n    this.items = []\n  }\n', '  clear(): void {\n    this.items = []\n  }\n\n  get size(): number {\n    return this.items.length\n  }\n').replace('import { Item } from "./item"', 'import type { Item } from "./item"'))
  writeFileSync(join(proj, 'src', 'discount.ts'), '/** A price less a percent, to the cent. */\nexport function discount(total: number, percent: number): number {\n  return Math.round(total * (100 - percent)) / 100\n}\n')
  writeFileSync(join(proj, 'README.md'), '# Shop\n\nA small shop with a cart and discounts.\n')

  const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLIO_DATA: f.data, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LANGUAGE: 'en' } })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await expect(win.getByTestId('shared')).toBeVisible()
  await win.evaluate(() => (window as unknown as { folio: { i18nSet(lang: string): unknown } }).folio.i18nSet('en'))
  await win.waitForTimeout(500)
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  }, [proj])
  await win.getByTestId('add-project').click(); await win.getByTestId('add-folder').click()
  const project = win.getByTestId('projects').locator('.project', { hasText: 'shop' })
  await project.locator('.project-row').click()
  // The pointer out of the picture; a moment for what it drew to settle.
  const shot = async (name: string) => {
    await win.mouse.move(1430, 890)
    await win.waitForTimeout(700)
    await win.screenshot({ path: join(OUT, name + '.png') })
  }

  // The welcome document: diagrams, boards, API.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:welcome'))
  const pane = win.locator('article.doc:not([hidden])')
  await expect(pane.locator('h1').first()).toBeVisible()
  const goTo = async (heading: string) => {
    await pane.locator('h2', { hasText: heading }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await win.waitForTimeout(1500)
  }
  await goTo('Diagrams'); await shot('diagrams')
  await goTo('Boards and calendars'); await shot('boards')
  await goTo('API references'); await shot('api')

  // A note edited.
  await project.locator('.tree .row.dir', { hasText: 'docs' }).click()
  await project.locator('.tree .row', { hasText: 'checkout.md' }).click()
  await expect(pane.locator('h1', { hasText: 'Checkout' })).toBeVisible()
  await win.keyboard.press(mod + '+e')
  await win.waitForTimeout(1500)
  await pane.evaluate((el) => el.closest('.view')!.scrollTo(0, 330))
  await shot('edit')

  // Code with its changes in the gutter, and a console.
  await project.locator('.tree .row.dir', { hasText: 'src' }).click()
  await project.locator('.tree .row', { hasText: 'cart.ts' }).first().click()
  await win.keyboard.press(mod + '+e')
  await expect(win.locator('.dsk-code-editor').first()).toBeVisible()
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:console', p), proj)
  await expect(win.getByTestId('console').first()).toBeVisible()
  await win.waitForTimeout(1500)
  await win.getByTestId('console').first().click()
  await win.keyboard.type("PROMPT='%1~ %# '; clear")
  await win.keyboard.press('Enter')
  await win.waitForTimeout(600)
  await win.keyboard.type('git log --oneline --graph --all')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(800)
  await win.keyboard.type('git status --short')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(800)
  // The language server: the agent renamed count, Item still says count.
  await win.locator('.dsk-code-editor').first().click()
  await expect(win.locator('.status').first()).not.toContainText('did not start', { timeout: 20000 })
  await win.waitForTimeout(4000)
  await shot('code')
  await win.getByTestId('toggle-console').click()

  // Claude Code connected; its edits reported.
  const settingsFile = join(proj, '.claude', 'settings.local.json')
  await win.keyboard.press(mod + '+k'); await win.keyboard.type('Claude'); await win.locator('[data-command="claude-connect"]').click()
  await expect.poll(() => (existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : '')).toContain('folio-review-events')
  const command: string = JSON.parse(readFileSync(settingsFile, 'utf8')).hooks.PostToolUse[0].hooks[0].command
  const events = /'([^']+)' # folio-review-events$/.exec(command)![1]!
  const now = Math.floor(Date.now() / 1000)
  for (const [file, cwd, s, t] of [['src/cart.ts', proj, 'a3f9c2e1-main', 'Edit'], ['src/discount.ts', proj, 'a3f9c2e1-main', 'Write'], ['README.md', proj, 'a3f9c2e1-main', 'Edit'], ['src/cart.test.ts', wt, '7b21d04f-sub', 'Write'], ['README.md', wt, '7b21d04f-sub', 'Edit']] as const)
    appendFileSync(events, JSON.stringify({ t: now - 40, e: { session_id: s, cwd, tool_name: t, tool_input: { file_path: join(cwd, file) } } }) + '\n')

  // The review.
  await win.getByTestId('toggle-changes').click(); await win.getByTestId('changes-review').click(); await win.getByTestId('toggle-changes').click()
  const review = win.locator('[data-testid="review"]:visible')
  await expect(review.getByTestId('review-file')).toHaveCount(3)
  const c = review.locator('[data-path="src/cart.ts"]')
  await expect(c.locator('.rv-diff')).toBeVisible()
  const row = c.locator('tr.rv-row.rv-add[data-after="13"]')
  await row.hover(); await row.getByTestId('review-comment-add').click()
  await c.getByTestId('review-comment-input').fill('Keep it count: the API still sends count, and Item says count too.')
  await c.getByTestId('review-comment-save').click()
  await review.locator('[data-path="README.md"]').getByTestId('review-viewed').check()
  await review.evaluate((el) => el.closest('.view')!.scrollTo(0, 0))
  await shot('review')

  // Worktrees.
  await win.getByTestId('toggle-worktrees').click()
  const agent = win.getByTestId('worktrees-panel').getByTestId('worktree').filter({ hasText: 'tests-agent' })
  await agent.getByTestId('worktree-review').click()
  await expect(win.locator('[data-testid="review"]:visible').getByTestId('review-file')).toHaveCount(2)
  await shot('worktrees')
  await win.getByTestId('toggle-worktrees').click()

  // Tabs in groups, dark.
  const tab = (n: string) => win.getByRole('tab', { name: new RegExp(n) }).first()
  await tab('cart.ts').click({ button: 'right' }); await win.getByTestId('tab-new-group').click(); await win.getByTestId('tab-group-name').fill('Code'); await win.getByTestId('tab-group-name').press('Enter')
  await tab('Changes').click({ button: 'right' }); await win.getByTestId('tab-new-group').click(); await win.getByTestId('tab-group-name').fill('Review'); await win.getByTestId('tab-group-name').press('Enter')
  await tab('Worktree').click({ button: 'right' }); await win.getByTestId('tab-add-to-group').click(); await win.getByTestId('group-choice').filter({ hasText: 'Review' }).click()
  await tab('checkout').click({ button: 'right' }); await win.getByTestId('tab-color').click(); await win.getByTestId('color-orange').click()
  await tab('cart.ts').click()
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await shot('dark')
  await app.close()
})
