import { basename, extname } from 'node:path'
import { languageOf } from '@dskripchenko/syntax'

/**
 * What a document is, so the window draws and edits it with the right element
 * (ADR-001, stage 5): Markdown; BPMN and DMN (`<dsk-bpmn>`, `<dsk-dmn>`, with
 * their editors); draw.io (`<dsk-drawio>`, a view); OpenAPI (`<dsk-openapi>`,
 * the reference or its editor); AsyncAPI (`<dsk-asyncapi>`); a diagram in a
 * text notation (`<dsk-diagram>`, edited as source beside a preview); or any
 * other text.
 */
export type Format = 'markdown' | 'bpmn' | 'dmn' | 'drawio' | 'openapi' | 'asyncapi' | 'diagram' | 'kanban' | 'calendar' | 'text'

/** The text notations, by extension, with the syntax `<dsk-diagram>` reads them in. */
export const DIAGRAM_SYNTAX: Readonly<Record<string, string>> = {
  '.mmd': 'mermaid',
  '.mermaid': 'mermaid',
  '.puml': 'plantuml',
  '.plantuml': 'plantuml',
  '.pu': 'plantuml',
  '.iuml': 'plantuml',
  '.dot': 'dot',
  '.gv': 'dot',
  '.d2': 'd2',
  '.dbml': 'dbml',
  '.dsl': 'structurizr',
  '.wardley': 'wardley',
}

export const MARKDOWN_EXT = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt']
const DATA_EXT = ['.yaml', '.yml', '.json']

/** The extensions folio opens, for the Open dialog. */
export const OPENABLE_EXT = [...MARKDOWN_EXT, '.bpmn', '.dmn', '.drawio', '.dio', ...Object.keys(DIAGRAM_SYNTAX), ...DATA_EXT]

/** Of a YAML or JSON document, from its first lines: an API description, or plain data. */
export function sniffData(text: string): 'openapi' | 'asyncapi' | 'text' {
  const head = text.slice(0, 4096)
  // A top-level YAML key (no indentation), or a JSON key.
  const says = (key: string) => new RegExp(`^${key}\\s*:|"${key}"\\s*:`, 'm').test(head)
  if (says('openapi') || says('swagger')) return 'openapi'
  if (says('asyncapi')) return 'asyncapi'
  return 'text'
}

/** By the name alone; YAML and JSON are `data` until their text says what they are. */
export function formatByName(name: string): Format | 'data' {
  const lower = basename(name).toLowerCase()
  if (lower.endsWith('.drawio.svg') || lower.endsWith('.drawio.xml')) return 'drawio'
  // A board or a calendar written as markup: Markdown to anything else, drawn as itself here.
  if (lower.endsWith('.kanban.md')) return 'kanban'
  if (lower.endsWith('.calendar.md')) return 'calendar'
  const ext = extname(lower)
  if (MARKDOWN_EXT.includes(ext)) return 'markdown'
  if (ext === '.bpmn') return 'bpmn'
  if (ext === '.dmn') return 'dmn'
  if (ext === '.drawio' || ext === '.dio') return 'drawio'
  if (ext in DIAGRAM_SYNTAX) return 'diagram'
  if (DATA_EXT.includes(ext)) return 'data'
  return 'text'
}

export function formatOf(name: string, text: string): Format {
  const byName = formatByName(name)
  return byName === 'data' ? sniffData(text) : byName
}

/** Files a link in a document opens in folio (others go to the system). */
export function opensInFolio(name: string): boolean {
  const byName = formatByName(name)
  return byName !== 'text' || MARKDOWN_EXT.includes(extname(name).toLowerCase()) || languageOf(name) !== null
}
