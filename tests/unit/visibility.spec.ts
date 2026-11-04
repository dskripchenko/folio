import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileIndex } from '../../src/main/fileIndex'
import { Ignores } from '../../src/main/ignore'
import { listDir } from '../../src/main/tree'
import { visibilityOf } from '../../src/main/visibility'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-vis-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (rel: string, text = '') => {
  const full = join(dir, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}
const names = (rel: string, v: ReturnType<typeof visibilityOf>, all = true) => (listDir(dir, rel, all, v) ?? []).map((e) => e.name)

describe('what the tree and the index show', () => {
  it('under git: .gitignore decides; a code project shows its dot files, a notes project hides them', () => {
    mkdirSync(join(dir, '.git'))
    put('.gitignore', 'node_modules/\ndist/\n*.log\n')
    put('.github/workflows/ci.yml', 'on: push\n')
    put('.editorconfig', 'root = true\n')
    put('node_modules/x/index.js')
    put('dist/app.js')
    put('vendor/lib.php', '<?php\n')
    put('src/main.ts', 'export {}\n')
    put('debug.log')
    const ignores = new Ignores()
    const code = visibilityOf(dir, 'code', ignores)
    expect(names('', code)).toEqual(['.github', 'src', 'vendor', '.editorconfig', '.gitignore'])
    const notes = visibilityOf(dir, 'notes', ignores)
    expect(names('', notes)).toEqual(['src', 'vendor'])
  })

  it('without git: folio’s own lists, as before', () => {
    put('node_modules/x.js')
    put('vendor/lib.php', '<?php\n')
    put('notes/a.md', '# a\n')
    put('.hidden/b.md')
    const v = visibilityOf(dir, 'notes', new Ignores())
    expect(names('', v)).toEqual(['notes', 'vendor'])
    expect(v.indexed('vendor', join(dir, 'vendor'), true)).toBe(false)
  })

  it('the index walks what is shown', async () => {
    mkdirSync(join(dir, '.git'))
    put('.gitignore', 'build/\n')
    put('build/out.ts', 'x\n')
    put('src/a.ts', 'x\n')
    const files = await new FileIndex().files('r', dir, visibilityOf(dir, 'code', new Ignores()))
    expect(files.map((f) => f.path)).toEqual(['src/a.ts'])
  })
  it('a worktree inside the project (its .git a file): in the tree, not among the files to go to or search', () => {
    mkdirSync(join(dir, '.git'))
    put('main.ts', 'x')
    put('.claude/worktrees/agent/.git', 'gitdir: ../../../.git/worktrees/agent\n')
    put('.claude/worktrees/agent/main.ts', 'y')
    const v = visibilityOf(dir, 'code', new Ignores())
    expect(names('.claude/worktrees', v)).toEqual(['agent'])
    expect(v.indexed('agent', join(dir, '.claude', 'worktrees', 'agent'), true)).toBe(false)
    expect(v.indexed('.claude', join(dir, '.claude'), true)).toBe(true)
  })
})
