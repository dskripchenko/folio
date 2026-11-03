import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { applyEdits, realUris } from '../../src/main/lsp/manager'
import { findServer } from '../../src/main/lsp/servers'

const dir = mkdtempSync(join(tmpdir(), 'folio-lsp-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the text a server is told of', () => {
  it('edits in order, by line and UTF-16 character', () => {
    const text = 'const a = 1\nconst 😀 = 2\n'
    const once = applyEdits(text, [{ from: { line: 1, character: 6 }, to: { line: 1, character: 8 }, text: 'b' }])
    expect(once).toBe('const a = 1\nconst b = 2\n')
    // Each edit over the text the ones before it left.
    expect(
      applyEdits(text, [
        { from: { line: 0, character: 0 }, to: { line: 0, character: 0 }, text: '// top\n' },
        { from: { line: 1, character: 6 }, to: { line: 1, character: 7 }, text: 'x' },
      ]),
    ).toBe('// top\nconst x = 1\nconst 😀 = 2\n')
    // Past a line's end: at its end.
    expect(applyEdits('ab\ncd', [{ from: { line: 0, character: 99 }, to: { line: 1, character: 0 }, text: '' }])).toBe('abcd')
  })
})

describe('the files a server names', () => {
  it('by their real paths, in locations and in a workspace edit’s keys', () => {
    const real = join(dir, 'real')
    mkdirSync(real)
    writeFileSync(join(real, 'a.js'), '')
    symlinkSync(real, join(dir, 'link'))
    const linked = pathToFileURL(join(dir, 'link', 'a.js')).href
    const truth = pathToFileURL(join(realpathSync(real), 'a.js')).href
    const out = realUris({
      locations: [{ uri: linked, range: {} }],
      edit: { changes: { [linked]: [{ newText: 'uri' }] }, documentChanges: [{ textDocument: { uri: linked } }] },
      other: 'file:///not/a/uri/key',
    })
    expect(out.locations[0]!.uri).toBe(truth)
    expect(Object.keys(out.edit.changes)).toEqual([truth])
    expect(out.edit.changes[truth]![0]!.newText).toBe('uri')
    expect(out.edit.documentChanges[0]!.textDocument.uri).toBe(truth)
    expect(out.other).toBe('file:///not/a/uri/key')
  })
})

describe('finding a server', () => {
  it('the project’s setting first (a project command, trusted before it runs), off when it says false', async () => {
    const found = await findServer(dir, 'javascript', ['node', 'server.js', '--stdio'])
    expect(found).toMatchObject({ command: 'node', args: ['server.js', '--stdio'], local: true })
    expect(await findServer(dir, 'javascript', false)).toMatchObject({ none: true })
  })

  it('the project’s own binary before the PATH, as a project command', async () => {
    const bin = join(dir, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'typescript-language-server'), '#!/bin/sh\n', { mode: 0o755 })
    expect(await findServer(dir, 'typescript', undefined)).toMatchObject({ local: true, name: 'typescript-language-server', args: ['--stdio'] })
  })

  it('no server for a language nobody serves; a hint what to install for one that is known', async () => {
    expect(await findServer(dir, 'brainfuck', undefined)).toEqual({ none: true, install: null })
  })
})
