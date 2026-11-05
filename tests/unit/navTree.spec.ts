import { describe, expect, it } from 'vitest'
import { navTree } from '../../src/renderer/review/navTree'
import { fileType } from '../../src/renderer/fileTypes'

const show = (rows: ReturnType<typeof navTree>) => rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'dir' ? `${r.name}/` : r.name}`)

describe('navTree', () => {
  it('puts folders first, then files, each by name', () => {
    expect(show(navTree(['b.ts', 'src/z.ts', 'a.md', 'src/a.ts', 'docs/x.md']))).toEqual(['docs/', '  x.md', 'src/', '  a.ts', '  z.ts', 'a.md', 'b.ts'])
  })

  it('shows a chain of lone folders as one row', () => {
    expect(navTree(['src/renderer/review/a.ts', 'src/renderer/review/b.ts', 'src/main/c.ts'])).toEqual([
      { kind: 'dir', path: 'src', name: 'src', depth: 0 },
      { kind: 'dir', path: 'src/main', name: 'main', depth: 1 },
      { kind: 'file', path: 'src/main/c.ts', name: 'c.ts', depth: 2 },
      { kind: 'dir', path: 'src/renderer/review', name: 'renderer/review', depth: 1 },
      { kind: 'file', path: 'src/renderer/review/a.ts', name: 'a.ts', depth: 2 },
      { kind: 'file', path: 'src/renderer/review/b.ts', name: 'b.ts', depth: 2 },
    ])
    expect(show(navTree(['a/b/c/d.ts']))).toEqual(['a/b/c/', '  d.ts'])
  })

  it('leaves a collapsed folder’s insides out', () => {
    expect(show(navTree(['src/a/x.ts', 'src/b.ts', 'c.ts'], new Set(['src/a'])))).toEqual(['src/', '  a/', '  b.ts', 'c.ts'])
    expect(show(navTree(['src/a/x.ts', 'src/b.ts'], new Set(['src'])))).toEqual(['src/'])
  })
})

describe('fileType', () => {
  it('knows a file by its extension, the longest first', () => {
    expect(fileType('src/app.ts')?.name).toBe('TypeScript')
    expect(fileType('a.js')?.name).toBe('JavaScript')
    expect(fileType('Controller.php')?.name).toBe('PHP')
    expect(fileType('resources/views/home.blade.php')?.name).toBe('Blade')
    expect(fileType('types.d.ts')?.name).toBe('TypeScript')
    expect(fileType('App.VUE')?.name).toBe('Vue')
  })

  it('knows some files by their whole name', () => {
    expect(fileType('package.json')?.name).toBe('npm')
    expect(fileType('composer.lock')?.name).toBe('Lock file')
    expect(fileType('Dockerfile')?.name).toBe('Docker')
    expect(fileType('Dockerfile.prod')?.name).toBe('Docker')
    expect(fileType('.env.example')?.name).toBe('Environment')
    expect(fileType('vite.config.ts')?.name).toBe('TypeScript')
    expect(fileType('.gitignore')?.name).toBe('git')
  })

  it('has none for an unknown one', () => {
    expect(fileType('README')).toBeNull()
    expect(fileType('x.qqq')).toBeNull()
    expect(fileType('.hidden')).toBeNull()
  })
})
