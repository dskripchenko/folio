import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { create, duplicate, FileOpError, move, rename } from '../../src/main/fileOps'

const box = () => mkdtempSync(join(tmpdir(), 'folio-ops-'))

describe('file operations from the tree', () => {
  it('a note (Markdown by default, with its title) and a folder', () => {
    const d = box()
    const note = create(d, 'Ideas', 'note')
    expect(note).toBe(join(d, 'Ideas.md'))
    expect(readFileSync(note, 'utf8')).toBe('# Ideas\n\n')
    expect(create(d, 'data.json', 'note')).toBe(join(d, 'data.json'))
    expect(existsSync(create(d, 'sub', 'folder'))).toBe(true)
    expect(() => create(d, 'Ideas', 'note')).toThrow(FileOpError)
    expect(() => create(d, 'a/b', 'note')).toThrow(/characters/)
    expect(() => create(d, '  ', 'folder')).toThrow(/empty/)
  })

  it('renamed: the extension kept; a name taken refused; only the case changed allowed', () => {
    const d = box()
    writeFileSync(join(d, 'a.md'), 'x')
    writeFileSync(join(d, 'b.md'), 'y')
    expect(rename(join(d, 'a.md'), 'c')).toBe(join(d, 'c.md'))
    expect(() => rename(join(d, 'c.md'), 'b')).toThrow(/exists/)
    expect(rename(join(d, 'c.md'), 'C')).toBe(join(d, 'C.md'))
  })

  it('moved into a folder, not into itself', () => {
    const d = box()
    mkdirSync(join(d, 'x', 'y'), { recursive: true })
    writeFileSync(join(d, 'n.md'), 'n')
    expect(move(join(d, 'n.md'), join(d, 'x'))).toBe(join(d, 'x', 'n.md'))
    expect(() => move(join(d, 'x'), join(d, 'x', 'y'))).toThrow(/inside/)
    writeFileSync(join(d, 'n.md'), 'again')
    expect(() => move(join(d, 'n.md'), join(d, 'x'))).toThrow(/exists/)
  })

  it('a copy beside, numbered', () => {
    const d = box()
    writeFileSync(join(d, 'n.md'), 'n')
    expect(duplicate(join(d, 'n.md'))).toBe(join(d, 'n copy.md'))
    expect(duplicate(join(d, 'n.md'))).toBe(join(d, 'n copy 2.md'))
  })
})
