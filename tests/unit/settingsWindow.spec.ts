import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readProjectSettings, writeProjectSettings } from '../../src/main/projectSettings'
import { portableKey, prettyKey } from '../../src/renderer/settingsDialog'

const dir = mkdtempSync(join(tmpdir(), 'folio-settings-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('a project’s settings written from the window', () => {
  it('the keys folio knows replaced, an empty one removed, every other key kept', () => {
    mkdirSync(join(dir, '.folio'))
    writeFileSync(join(dir, '.folio', 'settings.json'), JSON.stringify({ team: 'docs', formatter: 'prettier', tasks: [{ name: 'old', command: 'x' }] }))
    writeProjectSettings(dir, { tabSize: 2, formatOnSave: true, formatter: 'gofmt', tasks: [], lsp: { python: false } })
    expect(JSON.parse(readFileSync(join(dir, '.folio', 'settings.json'), 'utf8'))).toEqual({ team: 'docs', formatter: 'gofmt', tabSize: 2, formatOnSave: true, lsp: { python: false } })
    // What does not make sense is not written.
    writeProjectSettings(dir, { tabSize: 99, indentUnit: 'xx' } as never)
    expect(readProjectSettings(dir).tabSize).toBeUndefined()
    expect(readFileSync(join(dir, '.folio', 'settings.json'), 'utf8')).toMatch(/\n$/)
  })
})

describe('keys', () => {
  it('kept in the file with Mod, the platform’s command key', () => {
    expect(portableKey('Meta-Shift-k', true)).toBe('Mod-Shift-k')
    expect(portableKey('Ctrl-Shift-k', false)).toBe('Mod-Shift-k')
    expect(portableKey('Ctrl-k', true)).toBe('Ctrl-k')
    expect(portableKey('Alt-Shift-y', true)).toBe('Alt-Shift-y')
  })

  it('shown as each system writes them', () => {
    expect(prettyKey('Mod-Shift-k', true)).toBe('⌘⇧K')
    expect(prettyKey('Mod-Shift-k', false)).toBe('Ctrl+Shift+K')
    expect(prettyKey('Alt-ArrowUp', false)).toBe('Alt+Up')
  })
})
