import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { globalExcludesFile, Ignore, Ignores, parseIgnore } from '../../src/main/ignore'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-ignore-'))
  mkdirSync(join(dir, '.git', 'info'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (rel: string, text = '') => {
  const full = join(dir, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

describe('.gitignore read as git reads it', () => {
  it('names at any depth, anchored paths, folders only, negation, ** and classes', () => {
    put(
      '.gitignore',
      ['node_modules/', '*.log', '!keep.log', '/build', 'docs/*.pdf', '**/tmp/**', 'cache?', '[Dd]ebug', '\\#hash', 'trail\\ '].join('\n'),
    )
    const ig = new Ignore(dir, null)
    expect(ig.ignored('node_modules', true)).toBe(true)
    expect(ig.ignored('a/node_modules', true)).toBe(true)
    expect(ig.ignored('node_modules', false)).toBe(false)
    expect(ig.ignored('a/b/x.log', false)).toBe(true)
    expect(ig.ignored('a/keep.log', false)).toBe(false)
    expect(ig.ignored('build', true)).toBe(true)
    expect(ig.ignored('src/build', true)).toBe(false)
    expect(ig.ignored('docs/a.pdf', false)).toBe(true)
    expect(ig.ignored('docs/sub/a.pdf', false)).toBe(false)
    expect(ig.ignored('x/tmp/y/z.txt', false)).toBe(true)
    expect(ig.ignored('cache1', false)).toBe(true)
    expect(ig.ignored('cache12', false)).toBe(false)
    expect(ig.ignored('Debug', true)).toBe(true)
    expect(ig.ignored('#hash', false)).toBe(true)
    expect(ig.ignored('trail ', false)).toBe(true)
  })

  it('a deeper file wins; a folder left out cannot be taken back inside', () => {
    put('.gitignore', 'dist/\n*.tmp\n')
    put('pkg/.gitignore', '!a.tmp\n')
    put('dist/.gitignore', '!*\n')
    const ig = new Ignore(dir, null)
    expect(ig.ignored('pkg/a.tmp', false)).toBe(false)
    expect(ig.ignored('pkg/b.tmp', false)).toBe(true)
    expect(ig.ignored('a.tmp', false)).toBe(true)
    expect(ig.ignored('dist/x.js', false)).toBe(true)
  })

  it('.git/info/exclude and the global file; forgotten when changed', () => {
    put('.git/info/exclude', 'secret.txt\n')
    const global = join(dir, 'global-ignore')
    writeFileSync(global, '.DS_Store\n')
    let ig = new Ignore(dir, global)
    expect(ig.ignored('secret.txt', false)).toBe(true)
    expect(ig.ignored('a/.DS_Store', false)).toBe(true)
    put('.gitignore', 'later\n')
    expect(ig.ignored('later', false)).toBe(false)
    ig.forget()
    expect(ig.ignored('later', false)).toBe(true)
    ig = new Ignore(dir, null)
    expect(ig.ignored('a/.DS_Store', false)).toBe(false)
  })

  it('agrees with git itself on a mixed tree', () => {
    let git = true
    try {
      execFileSync('git', ['--version'])
    } catch {
      git = false
    }
    if (!git) return
    put('.gitignore', 'node_modules/\n*.log\n!important.log\n/out\nsrc/**/gen/\n')
    put('src/.gitignore', '*.bak\n!keep.bak\n')
    const paths = ['node_modules/x.js', 'a.log', 'important.log', 'logs/b.log', 'out/a.js', 'src/out/a.js', 'src/a/gen/x.ts', 'src/gen/y.ts', 'src/z.bak', 'src/keep.bak', 'z.bak', 'src/ok.ts']
    for (const p of paths) put(p)
    execFileSync('git', ['init', '-q'], { cwd: dir })
    let listed: string
    try {
      listed = execFileSync('git', ['check-ignore', ...paths], { cwd: dir, encoding: 'utf8' })
    } catch (e) {
      listed = String((e as { stdout?: string }).stdout ?? '')
    }
    const byGit = new Set(listed.split('\n').filter(Boolean))
    const ig = new Ignore(dir, null)
    for (const p of paths) expect(ig.ignored(p, false), p).toBe(byGit.has(p))
  })
})

describe('ignore rules by repository', () => {
  it('finds the repository of a folder and answers for absolute paths', () => {
    put('.gitignore', 'tmp/\n')
    put('src/a.ts')
    const ignores = new Ignores()
    expect(ignores.ignored(join(dir, 'tmp'), true)).toBe(true)
    expect(ignores.ignored(join(dir, 'src', 'a.ts'), false)).toBe(false)
    expect(ignores.of(tmpdir())).toBeNull()
    expect(ignores.changed([join(dir, '.gitignore')])).toBe(true)
  })

  it('the global excludes file from ~/.gitconfig, else the XDG one', () => {
    const home = join(dir, 'home')
    mkdirSync(home)
    expect(globalExcludesFile(home, {})).toBe(join(home, '.config', 'git', 'ignore'))
    writeFileSync(join(home, '.gitconfig'), '[user]\n  name = x\n[core]\n  excludesFile = ~/my-ignore\n')
    expect(globalExcludesFile(home, {})).toBe(join(home, 'my-ignore'))
  })

  it('parses nothing from comments and blank lines', () => {
    expect(parseIgnore('# c\n\n   \n', '')).toEqual([])
  })
})
