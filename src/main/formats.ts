import { basename, extname } from 'node:path'
import { languageOf } from '@dskripchenko/syntax'

/**
 * What a document is, so the window draws and edits it with the right element
 * (ADR-001, stage 5): Markdown; BPMN and DMN (`<dsk-bpmn>`, `<dsk-dmn>`, with
 * their editors); draw.io (`<dsk-drawio>`, a view); OpenAPI (`<dsk-openapi>`,
 * the reference or its editor); AsyncAPI (`<dsk-asyncapi>`); a diagram in a
 * text notation (`<dsk-diagram>`, edited as source beside a preview); or any
 * other text; a kanban board, a calendar, a whiteboard (`<dsk-board>`).
 */
export type Format =
  | 'markdown'
  | 'bpmn'
  | 'dmn'
  | 'drawio'
  | 'openapi'
  | 'asyncapi'
  | 'diagram'
  | 'kanban'
  | 'calendar'
  | 'board'
  | 'text'
  | 'csv'
  | 'svg'
  | 'image'
  | 'video'
  | 'audio'

/** Pictures, video and sound the window shows itself (what Chromium decodes). An SVG is text: `svg`, drawn and edited. */
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.avif', '.bmp', '.ico', '.apng']
export const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.mkv']
export const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.weba']

/** Formats whose file is not text: never read as text, served to the window by the folio scheme. */
export function isMedia(format: Format | 'data'): format is 'image' | 'video' | 'audio' {
  return format === 'image' || format === 'video' || format === 'audio'
}

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
export const OPENABLE_EXT = [
  ...MARKDOWN_EXT,
  '.bpmn',
  '.dmn',
  '.drawio',
  '.dio',
  '.board',
  ...Object.keys(DIAGRAM_SYNTAX),
  ...DATA_EXT,
  '.csv',
  '.tsv',
  '.svg',
  ...IMAGE_EXT,
  ...VIDEO_EXT,
  ...AUDIO_EXT,
]

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
  // A whiteboard: @dskripchenko/board's JSON.
  if (ext === '.board') return 'board'
  if (ext in DIAGRAM_SYNTAX) return 'diagram'
  if (DATA_EXT.includes(ext)) return 'data'
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (ext === '.svg') return 'svg'
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
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
