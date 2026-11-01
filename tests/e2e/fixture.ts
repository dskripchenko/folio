import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const here = join(import.meta.dirname, '..', 'fixtures')

/** A 4×4 red PNG: a picture by relative path that must load. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC', 'base64')

export interface Fixture {
  root: string
  folder: string
  doc: string
  other: string
  data: string
}

/** A folder with a document of every kind of block, a picture, a second document and a secret outside. */
export function fixture(webPicture?: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'folio-e2e-'))
  const folder = join(root, 'notes')
  mkdirSync(join(folder, 'img'), { recursive: true })
  writeFileSync(join(root, 'secret.txt'), 'outside the folder')
  writeFileSync(join(folder, 'img', 'red.png'), PNG)
  writeFileSync(join(folder, 'other.md'), '# Other\n\nThe second document.\n')
  const block = (lang: string, body: string) => '```' + lang + '\n' + body.trim() + '\n```\n'
  const doc = [
    '# Everything',
    '',
    'A picture: ![red](img/red.png)',
    '',
    'A [link to the other document](other.md).',
    '',
    webPicture ? `From the web: ![web](${webPicture})\n` : '',
    block('mermaid', 'flowchart LR\n  A[Cart] --> B[Paid]'),
    block('plantuml', '@startuml\nAlice -> Bob: hello\n@enduml'),
    block('dot', 'digraph { a -> b }'),
    block('openapi', 'openapi: 3.1.0\ninfo: {title: Orders, version: 1.0.0}\npaths:\n  /orders:\n    get:\n      summary: List orders\n      responses: {"200": {description: OK}}'),
    block('asyncapi', readFileSync(join(here, 'orders-3.yaml'), 'utf8')),
    block('bpmn', readFileSync(join(here, 'order.bpmn'), 'utf8')),
    block('drawio', readFileSync(join(here, 'architecture.drawio'), 'utf8')),
    block('kanban', '## To do\n- Write the docs\n## Done\n- Ship it'),
    block('calendar', 'date: 2026-11-01\n2026-11-03 10:00 Review'),
    block('video', 'src: media/clip.webm\npreload: none'),
  ].join('\n')
  writeFileSync(join(folder, 'everything.md'), doc)
  return { root, folder, doc: join(folder, 'everything.md'), other: join(folder, 'other.md'), data: join(root, 'folio-data') }
}
