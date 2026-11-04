import { crc32, deflateRawSync } from 'node:zlib'

/**
 * A Word document from a note (ADR-004 D6): the window reads its drawn
 * document into these blocks (a diagram already a picture), this writes the
 * OOXML and packs it — headings, paragraphs with emphasis, links, lists,
 * quotes, code, tables, pictures, rules. Nothing but what is listed: Word's
 * own styles for the rest.
 */

export type Inline =
  | { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean; link?: string }
  | { image: number; width: number; height: number }
  | { break: true }

export type Block =
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Block[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: Inline[][][]; header: boolean }
  | { kind: 'rule' }

export interface DocxImage {
  /** PNG or JPEG bytes. */
  data: Uint8Array
  type: 'png' | 'jpeg'
}

export interface DocxModel {
  title: string
  blocks: Block[]
  images: DocxImage[]
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 cannot hold.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** The widest a picture may be: the page's text width (A4 with 2 cm margins), in EMU. */
const MAX_WIDTH = Math.round((21 - 4) / 2.54 * 914400)
const EMU_PER_PX = 9525

class Writer {
  private rels: string[] = []
  private relSeq = 0
  /** Each ordered list counts from 1 again: a numbering instance of its own. */
  private nums: number[] = []
  private drawing = 0

  constructor(private readonly images: DocxImage[]) {
    for (let i = 0; i < images.length; i++) {
      const id = this.rel('image', `media/image${i + 1}.${images[i]!.type === 'png' ? 'png' : 'jpeg'}`)
      this.imageRel.set(i, id)
    }
  }

  readonly imageRel = new Map<number, string>()

  rel(type: 'image' | 'hyperlink', target: string): string {
    const id = `rId${++this.relSeq + 10}`
    const base = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
    this.rels.push(
      `<Relationship Id="${id}" Type="${base}${type}" Target="${esc(target)}"${type === 'hyperlink' ? ' TargetMode="External"' : ''}/>`,
    )
    return id
  }

  get relationships(): string[] {
    return this.rels
  }

  get orderedLists(): number[] {
    return this.nums
  }

  run(i: Inline): string {
    if ('break' in i) return '<w:r><w:br/></w:r>'
    if ('image' in i) return this.picture(i.image, i.width, i.height)
    const props = [
      i.bold ? '<w:b/>' : '',
      i.italic ? '<w:i/>' : '',
      i.strike ? '<w:strike/>' : '',
      i.code ? '<w:rStyle w:val="InlineCode"/>' : '',
      i.link ? '<w:rStyle w:val="Hyperlink"/>' : '',
    ].join('')
    // Line breaks inside a text: breaks of the run.
    const parts = i.text.split('\n').map((t) => `<w:t xml:space="preserve">${esc(t)}</w:t>`)
    const run = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${parts.join('<w:br/>')}</w:r>`
    return i.link && /^(https?|mailto):/i.test(i.link) ? `<w:hyperlink r:id="${this.rel('hyperlink', i.link)}">${run}</w:hyperlink>` : run
  }

  picture(index: number, width: number, height: number): string {
    const rid = this.imageRel.get(index)
    if (!rid) return ''
    let cx = Math.max(1, Math.round(width * EMU_PER_PX))
    let cy = Math.max(1, Math.round(height * EMU_PER_PX))
    if (cx > MAX_WIDTH) {
      cy = Math.round((cy * MAX_WIDTH) / cx)
      cx = MAX_WIDTH
    }
    const id = ++this.drawing
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${id}" name="Picture ${id}"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    )
  }

  para(inlines: Inline[], props = ''): string {
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inlines.map((i) => this.run(i)).join('')}</w:p>`
  }

  blocks(blocks: Block[], quote = 0, list?: { num: number; level: number }): string {
    return blocks.map((b) => this.block(b, quote, list)).join('')
  }

  private block(b: Block, quote: number, list?: { num: number; level: number }): string {
    const quoted = quote > 0 ? `<w:pStyle w:val="Quote"/><w:ind w:left="${quote * 567}"/>` : ''
    const listed = list ? `<w:numPr><w:ilvl w:val="${list.level}"/><w:numId w:val="${list.num}"/></w:numPr>` : ''
    switch (b.kind) {
      case 'heading':
        return this.para(b.inlines, `<w:pStyle w:val="Heading${Math.min(6, Math.max(1, b.level))}"/>`)
      case 'paragraph':
        return this.para(b.inlines, (list ? `<w:pStyle w:val="ListParagraph"/>${listed}` : '') + quoted)
      case 'code':
        return b.text
          .replace(/\n$/, '')
          .split('\n')
          .map((line) => this.para([{ text: line }], `<w:pStyle w:val="Code"/>${quoted}`))
          .join('')
      case 'rule':
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>'
      case 'quote':
        return this.blocks(b.blocks, quote + 1, list)
      case 'list': {
        const level = list ? list.level + 1 : 0
        let num = 1
        if (b.ordered) {
          this.nums.push(this.nums.length + 2)
          num = this.nums[this.nums.length - 1]!
        }
        return b.items
          .map((item) =>
            // An item's first paragraph carries the number; the rest are its own, indented.
            item
              .map((block, k) =>
                block.kind === 'list'
                  ? this.block(block, quote, { num, level: level })
                  : k === 0
                    ? this.block(block.kind === 'paragraph' ? block : { kind: 'paragraph', inlines: [] }, quote, { num, level }) +
                      (block.kind === 'paragraph' ? '' : this.block(block, quote))
                    : this.block(block, quote),
              )
              .join(''),
          )
          .join('')
      }
      case 'table': {
        const cols = Math.max(1, ...b.rows.map((r) => r.length))
        const grid = Array.from({ length: cols }, () => '<w:gridCol/>').join('')
        const rows = b.rows
          .map((row, k) => {
            const header = b.header && k === 0
            const cells = Array.from({ length: cols }, (_, c) => {
              const inlines = (row[c] ?? []).map((i) => (header && 'text' in i ? { ...i, bold: true } : i))
              return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${this.para(inlines)}</w:tc>`
            }).join('')
            return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`
          })
          .join('')
        return (
          '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>' +
          '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders>' +
          `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl><w:p/>`
        )
      }
    }
  }
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[1, 2, 3, 4, 5, 6]
  .map(
    (n) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n <= 2 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[40, 32, 28, 24, 22, 22][n - 1]}"/></w:rPr></w:style>`,
  )
  .join('\n')}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr></w:pPr><w:rPr><w:color w:val="595959"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="InlineCode"><w:name w:val="Inline Code"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`

/** Bullets (1) and numbers (2…, one instance per ordered list so each counts from 1). */
function numbering(ordered: number[]): string {
  const levels = (bullet: boolean) =>
    Array.from({ length: 9 }, (_, l) =>
      bullet
        ? `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${['•', '◦', '▪'][l % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
        : `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman'][l % 3]}"/><w:lvlText w:val="%${l + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`,
    ).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}">` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
    ordered.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('') +
    '</w:numbering>'
  )
}

export function buildDocx(model: DocxModel): Buffer {
  const w = new Writer(model.images)
  const body = w.blocks(model.blocks)
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    w.relationships.join('') +
    '</Relationships>'
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const files: [string, string | Uint8Array][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>',
    ],
    [
      'docProps/core.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${esc(model.title)}</dc:title><dc:creator>folio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    ],
    ['word/document.xml', document],
    ['word/styles.xml', STYLES],
    ['word/numbering.xml', numbering(w.orderedLists)],
    ['word/_rels/document.xml.rels', rels],
    ...model.images.map((img, i): [string, Uint8Array] => [`word/media/image${i + 1}.${img.type === 'png' ? 'png' : 'jpeg'}`, img.data]),
  ]
  return zip(files)
}

/** A ZIP of the files (deflated; pictures stored as they are). */
export function zip(files: [string, string | Uint8Array][]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of files) {
    const raw = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
    const store = /\.(png|jpe?g)$/i.test(name)
    const data = store ? raw : deflateRawSync(raw)
    const crc = crc32(raw)
    const fileName = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(store ? 0 : 8, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    local.writeUInt16LE(0, 28)
    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(20, 6)
    head.writeUInt16LE(0x0800, 8)
    head.writeUInt16LE(store ? 0 : 8, 10)
    head.writeUInt32LE(0, 12)
    head.writeUInt32LE(crc, 16)
    head.writeUInt32LE(data.length, 20)
    head.writeUInt32LE(raw.length, 24)
    head.writeUInt16LE(fileName.length, 28)
    head.writeUInt32LE(offset, 42)
    central.push(head, fileName)
    parts.push(local, fileName, data)
    offset += 30 + fileName.length + data.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dir, end])
}
