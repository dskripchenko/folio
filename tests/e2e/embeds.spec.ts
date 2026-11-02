import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, viewMode } from './fixture'

test('embedded notes: the whole note or a heading’s section, an embed inside an embed, a loop left a link; the editor keeps the embed as written', async () => {
  const f = fixture()
  const dir = join(f.folder, 'vault')
  mkdirSync(dir, { recursive: true })
  const index = join(dir, 'Index.md')
  writeFileSync(index, '# Index\n\n![[Plan#Goals]]\n\n![[Card]]\n\n![[Index]]\n')
  writeFileSync(join(dir, 'Plan.md'), '# Plan\n\nIntro.\n\n## Goals\n\nShip the embeds.\n\n## Risks\n\nNone.\n')
  writeFileSync(join(dir, 'Card.md'), '---\ntags: [x]\n---\n\nA card, with ![[Plan#Risks]] inside.\n')
  const app = await electron.launch({ args: ['.', index], env: { ...process.env, FOLIO_DATA: f.data } })
  try {
    const win = await app.firstWindow()
    const pane = win.locator('article.doc:not([hidden])')
    const goals = pane.locator('.uid-markdown__embed[data-embed="Plan#Goals"]')
    await expect(goals).toHaveClass(/is-filled/)
    await expect(goals.locator('.embed-body')).toContainText('Ship the embeds.')
    await expect(goals.locator('.embed-body')).not.toContainText('Intro.')
    await expect(goals.locator('.embed-body')).not.toContainText('None.')
    // An embed inside an embed; the card's properties not shown.
    const card = pane.locator('.uid-markdown__embed[data-embed="Card"]')
    await expect(card.locator('.embed-body').first()).toContainText('A card')
    await expect(card.locator('.uid-markdown__embed[data-embed="Plan#Risks"] .embed-body')).toContainText('None.')
    await expect(card.locator('table.uid-markdown__props')).toHaveCount(0)
    // The note embedding itself: left a link.
    await expect(pane.locator('.uid-markdown__embed[data-embed="Index"]')).toHaveAttribute('data-state', 'loop')

    // In the editor an embed stays its link, and an edit elsewhere keeps it as written.
    await viewMode(win, 'visual')
    const editor = pane.locator('dsk-markdown-editor [contenteditable="true"]')
    await expect(editor.locator('.uid-markdown__embed[data-embed="Plan#Goals"]')).toBeVisible()
    await expect(editor.locator('.embed-body')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
