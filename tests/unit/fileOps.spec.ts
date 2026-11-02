import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { create, duplicate, FileOpError, move, rename, saveAttachment } from '../../src/main/fileOps'

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

describe('pictures pasted into a note', () => {
  const png = new Uint8Array([137, 80, 78, 71])
  it('saved beside it in attachments/, by name, a taken name numbered', () => {
    const d = box()
    const note = join(d, 'Plan.md')
    writeFileSync(note, '')
    expect(saveAttachment(note, 'Diagram.png', 'image/png', png)).toBe('attachments/Diagram.png')
    expect(saveAttachment(note, 'Diagram.png', 'image/png', png)).toBe('attachments/Diagram 1.png')
    expect(readFileSync(join(d, 'attachments', 'Diagram 1.png'))).toEqual(Buffer.from(png))
  })

  it('a nameless screenshot gets the time; the type gives the extension; not a picture is refused', () => {
    const d = box()
    const note = join(d, 'Plan.md')
    expect(saveAttachment(note, 'image.png', 'image/png', png, new Date(2026, 10, 2, 9, 5, 7))).toBe('attachments/Pasted image 20261102090507.png')
    expect(saveAttachment(note, 'photo', 'image/jpeg', png)).toBe('attachments/photo.jpg')
    expect(saveAttachment(note, 'a:b?.png', 'image/png', png)).toBe('attachments/ab.png')
    expect(() => saveAttachment(note, 'x.exe', 'application/x-msdownload', png)).toThrow(FileOpError)
  })
})
