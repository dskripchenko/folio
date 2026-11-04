import { describe, expect, it } from 'vitest'
import { formatOf, opensInFolio, sniffData } from '../../src/main/formats'
import { kindOf } from '../../src/main/tree'

describe('document formats', () => {
  it('by extension', () => {
    expect(formatOf('a/notes.md', '')).toBe('markdown')
    expect(formatOf('order.BPMN', '')).toBe('bpmn')
    expect(formatOf('loan.dmn', '')).toBe('dmn')
    expect(formatOf('arch.drawio', '')).toBe('drawio')
    expect(formatOf('arch.drawio.svg', '<svg/>')).toBe('drawio')
    expect(formatOf('Release.kanban.md', '')).toBe('kanban')
    expect(formatOf('Duty.calendar.md', '')).toBe('calendar')
    expect(formatOf('Plan.board', '{}')).toBe('board')
    for (const name of ['a.mmd', 'a.puml', 'a.dot', 'a.gv', 'a.d2', 'a.dbml', 'a.dsl', 'a.wardley']) expect(formatOf(name, '')).toBe('diagram')
    expect(formatOf('notes.log', 'x')).toBe('text')
  })

  it('YAML and JSON by what they say they are', () => {
    expect(formatOf('api.yaml', 'openapi: 3.1.0\ninfo: {}\n')).toBe('openapi')
    expect(formatOf('api.yml', '# comment\nswagger: "2.0"\n')).toBe('openapi')
    expect(formatOf('openapi.json', '{\n  "openapi": "3.0.3",\n  "info": {}\n}')).toBe('openapi')
    expect(formatOf('events.yaml', 'asyncapi: 3.0.0\n')).toBe('asyncapi')
    expect(formatOf('config.yaml', 'name: x\nopenapi_like: no\n')).toBe('text')
    expect(sniffData('info:\n  openapi: nested\n')).toBe('text')
  })

  it('what the tree lists and what links open in folio', () => {
    expect(kindOf('a.md')).toBe('markdown')
    expect(kindOf('a.txt')).toBe('other')
    expect(kindOf('a.bpmn')).toBe('diagram')
    expect(kindOf('api.yaml')).toBe('diagram')
    expect(kindOf('openapi.json')).toBe('diagram')
    // Code, data and logs are listed too: shown highlighted.
    expect(kindOf('package.json')).toBe('code')
    expect(kindOf('main.rs')).toBe('code')
    expect(kindOf('app.log')).toBe('code')
    // Pictures, video and sound: shown in folio (media.spec.ts).
    expect(kindOf('photo.png')).toBe('media')
    expect(opensInFolio('a.bpmn')).toBe(true)
    expect(opensInFolio('a.txt')).toBe(true)
    expect(opensInFolio('report.pdf')).toBe(false)
  })
})
