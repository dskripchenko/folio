import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { kindOf, listDir } from '../../src/main/tree'
import { Watcher, type Changes } from '../../src/main/watcher'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-tree-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('tree: a folder as the sidebar lists it', () => {
  it('folders first, then documents, by name as people sort; tooling and hidden files left out', () => {
    for (const d of ['b', 'a', 'node_modules', '.git']) mkdirSync(join(dir, d))
    for (const f of ['note 10.md', 'note 2.md', 'flow.bpmn', 'x.log', '.hidden.md']) writeFileSync(join(dir, f), '')
    expect(listDir(dir, '')?.map((e) => e.name)).toEqual(['a', 'b', 'flow.bpmn', 'note 2.md', 'note 10.md', 'x.log'])
    expect(listDir(dir, '', true)?.map((e) => e.name)).toContain('x.log')
    expect(listDir(dir, '')?.find((e) => e.name === 'flow.bpmn')).toEqual({ name: 'flow.bpmn', path: 'flow.bpmn', type: 'file', kind: 'diagram' })
  })

  it('lists a subfolder with paths from the root, and nothing outside it', () => {
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'a.md'), '')
    expect(listDir(dir, 'sub')).toEqual([{ name: 'a.md', path: 'sub/a.md', type: 'file', kind: 'markdown' }])
    expect(listDir(join(dir, 'sub'), '..')).toBeNull()
  })

  it('knows the kinds', () => {
    expect([kindOf('a.MD'), kindOf('b.drawio'), kindOf('c.puml'), kindOf('d.png'), kindOf('e.zip')]).toEqual(['markdown', 'diagram', 'diagram', 'media', 'other'])
  })
})

describe('watcher', () => {
  it('reports the changed folder and file once, after a moment', async () => {
    mkdirSync(join(dir, 'sub'))
    const seen: Changes[][] = []
    const w = new Watcher((c) => seen.push(c), 100)
    w.add('r', dir)
    await new Promise((r) => setTimeout(r, 100))
    writeFileSync(join(dir, 'sub', 'a.md'), '1')
    writeFileSync(join(dir, 'sub', 'a.md'), '2')
    await expect.poll(() => seen.flat().flatMap((c) => c.files).includes(join(dir, 'sub', 'a.md')), { timeout: 3000 }).toBe(true)
    w.close()
    const all = seen.flat()
    expect(all.every((c) => c.root === 'r')).toBe(true)
    expect(all.flatMap((c) => c.dirs)).toContain('sub')
    expect(all.flatMap((c) => c.files)).toContain(join(dir, 'sub', 'a.md'))
  })
})
