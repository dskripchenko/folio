import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { buildDocx, type DocxModel } from '../../src/main/docx'

const dir = mkdtempSync(join(tmpdir(), 'folio-docx-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A 2×2 red PNG. */
function png(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(d.length)
    const body = Buffer.concat([Buffer.from(t), d])
    const s = Buffer.alloc(4)
    s.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, s])
  }
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0])
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const model: DocxModel = {
  title: 'Report',
  images: [{ data: png(), type: 'png' }],
  blocks: [
    { kind: 'heading', level: 1, inlines: [{ text: 'Quarterly report' }] },
    { kind: 'paragraph', inlines: [{ text: 'Plain, ' }, { text: 'bold', bold: true }, { text: ', ' }, { text: 'italic', italic: true }, { text: ', ' }, { text: 'code()', code: true }, { text: ' and ' }, { text: 'a link', link: 'https://example.com/a?b=1&c=2' }, { text: '.' }] },
    { kind: 'list', ordered: false, items: [[{ kind: 'paragraph', inlines: [{ text: 'First point' }] }, { kind: 'list', ordered: true, items: [[{ kind: 'paragraph', inlines: [{ text: 'Nested step' }] }]] }], [{ kind: 'paragraph', inlines: [{ text: 'Second point' }] }]] },
    { kind: 'quote', blocks: [{ kind: 'paragraph', inlines: [{ text: 'A quoted line <with> "marks" & more' }] }] },
    { kind: 'code', text: 'const a = 1\nconsole.log(a)\n' },
    { kind: 'table', header: true, rows: [[[{ text: 'Name' }], [{ text: 'Price' }]], [[{ text: 'Tea' }], [{ text: '1.50' }]]] },
    { kind: 'paragraph', inlines: [{ image: 0, width: 2000, height: 1000 }] },
    { kind: 'rule' },
  ],
}

describe('a Word document', () => {
  const file = join(dir, 'report.docx')
  writeFileSync(file, buildDocx(model))

  it('a sound ZIP with well-formed XML', () => {
    expect(execFileSync('unzip', ['-t', file], { encoding: 'utf8' })).toMatch(/No errors detected/)
    const list = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n')
    expect(list).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/media/image1.png']))
    for (const part of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml']) {
      // unzip reads [ ] as a pattern: escaped.
      const xml = execFileSync('unzip', ['-p', file, part.replace(/[[\]]/g, '\\$&')])
      // Parsed by xmllint when it is there.
      try {
        execFileSync('xmllint', ['--noout', '-'], { input: xml })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
    const document = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' })
    // A picture wider than the page: scaled to its text width.
    expect(document).toMatch(/<wp:extent cx="6120000" cy="3060000"\/>/)
  })

  it.skipIf(process.platform !== 'darwin')('read by a word processor: the text in order', () => {
    const text = execFileSync('textutil', ['-convert', 'txt', '-stdout', file], { encoding: 'utf8' })
    for (const words of ['Quarterly report', 'Plain, bold, italic, code() and a link.', 'First point', 'Nested step', 'Second point', 'A quoted line <with> "marks" & more', 'const a = 1', 'console.log(a)', 'Tea', '1.50'])
      expect(text).toContain(words)
    expect(text.indexOf('Quarterly report')).toBeLessThan(text.indexOf('Second point'))
  })
})
