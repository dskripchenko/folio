import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readProjectSettings } from '../../src/main/projectSettings'
import { justRecipes, makeTargets, tasksOf } from '../../src/main/projectTasks'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-tasks-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('a project’s tasks', () => {
  it('scripts by the package manager of the lockfile, composer scripts, make targets, just recipes, folio’s own', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', test: 'vitest' } }))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writeFileSync(join(dir, 'composer.json'), JSON.stringify({ scripts: { lint: 'pint', 'post-install-cmd': 'x' } }))
    writeFileSync(join(dir, 'Makefile'), '.PHONY: all\nall: app\napp: main.o\n\tcc\n%.o: %.c\n\tcc\nVAR := 1\nclean deploy:\n\trm\n')
    writeFileSync(join(dir, 'justfile'), 'set shell := ["bash"]\ndefault:\n  just --list\n_private:\n  x\nrelease version:\n  echo\n')
    mkdirSync(join(dir, '.folio'))
    writeFileSync(join(dir, '.folio', 'settings.json'), JSON.stringify({ tasks: [{ name: 'serve', command: 'php artisan serve' }, { name: 3 }] }))
    expect(tasksOf(dir).map((t) => `${t.source}:${t.name}:${t.command}`)).toEqual([
      'npm:build:pnpm run build',
      'npm:test:pnpm run test',
      'composer:lint:composer run-script lint',
      'make:all:make all',
      'make:app:make app',
      'make:clean:make clean',
      'make:deploy:make deploy',
      'just:default:just default',
      'just:release:just release',
      'folio:serve:php artisan serve',
    ])
  })

  it('reads only what it understands of .folio/settings.json', () => {
    mkdirSync(join(dir, '.folio'))
    writeFileSync(join(dir, '.folio', 'settings.json'), JSON.stringify({ kind: 'code', indentUnit: '  ', tabSize: 2, formatOnSave: true, formatter: 'prettier', other: 1, kindx: 'x' }))
    expect(readProjectSettings(dir)).toEqual({ kind: 'code', indentUnit: '  ', tabSize: 2, formatOnSave: true, formatter: 'prettier' })
    writeFileSync(join(dir, '.folio', 'settings.json'), '{ broken')
    expect(readProjectSettings(dir)).toEqual({})
    expect(makeTargets('a.o: a.c\n')).toEqual([])
    expect(justRecipes('x := "1"\n')).toEqual([])
  })
})
