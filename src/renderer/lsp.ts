/**
 * A file in the code editor and its language server (ADR-003): opened in the
 * server with the editor, every change sent to it, and what the server knows
 * — hover, a call's parameters, definitions, completion, references, renames,
 * actions, formatting, symbols — asked at positions of the editor's text.
 */
import type { CodeEditor, CompletionItem } from '@dskripchenko/code-editor'
import { highlight, type SymbolKind, type SymbolNode } from '@dskripchenko/syntax'

export interface LspBridge {
  lspOpen(path: string, text: string): Promise<LspOpenResult>
  lspChange(path: string, edits: unknown[]): void
  lspSave(path: string): void
  lspClose(path: string): void
  lspRequest(path: string, method: string, params: Record<string, unknown>): Promise<unknown>
}

export type LspOpenResult =
  | { status: 'ok'; server: string; capabilities: Record<string, unknown>; real?: string }
  | { status: 'none'; install: string | null }
  | { status: 'untrusted'; server: string }
  | { status: 'failed'; server: string; error: string }

export interface LspPosition {
  line: number
  character: number
}
export interface LspRange {
  start: LspPosition
  end: LspPosition
}
export interface LspLocation {
  path: string
  range: LspRange
}
export interface TextEdit {
  range: LspRange
  newText: string
}

/** A file path from a `file:` address (null for another kind). */
export function pathOfUri(uri: string): string | null {
  try {
    const u = new URL(uri)
    if (u.protocol !== 'file:') return null
    const path = decodeURIComponent(u.pathname)
    return /^\/[A-Za-z]:/.test(path) ? path.slice(1).replace(/\//g, '\\') : path
  } catch {
    return null
  }
}

export class LspBinding {
  private readonly off: (() => void)[] = []

  constructor(
    readonly editor: CodeEditor,
    readonly path: string,
    readonly server: string,
    readonly capabilities: Record<string, unknown>,
    private readonly bridge: LspBridge,
    /** The file's real path (what the server names it by), when the editor's differs. */
    readonly real: string = path,
  ) {
    const changed = (e: Event) => {
      const edits = (e as CustomEvent<{ edits?: unknown[] }>).detail.edits
      if (edits?.length) bridge.lspChange(path, edits)
    }
    editor.dom.addEventListener('dsk:change', changed)
    this.off.push(() => editor.dom.removeEventListener('dsk:change', changed))
  }

  has(capability: string): boolean {
    const c = this.capabilities[capability]
    return c !== undefined && c !== null && c !== false
  }

  /** An offset of the editor's text as a position. */
  position(offset: number): LspPosition {
    const line = this.editor.state.doc.lineAt(offset)
    return { line: line.index, character: offset - line.from }
  }

  /** A position as an offset of the editor's text (clamped into it). */
  offset(p: LspPosition): number {
    const doc = this.editor.state.doc
    const index = Math.max(0, Math.min(doc.lineCount - 1, p.line))
    return Math.min(doc.lineEnd(index), doc.lineStart(index) + Math.max(0, p.character))
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T | null> {
    return this.bridge.lspRequest(this.path, method, params) as Promise<T | null>
  }

  at(pos: number): Record<string, unknown> {
    return { position: this.position(pos) }
  }

  dispose(): void {
    for (const f of this.off) f()
    this.bridge.lspClose(this.path)
  }
}

// What servers write: markdown, kept as text --------------------------------------

type Markup = string | { kind?: string; value: string; language?: string } | (string | { language: string; value: string })[]

/**
 * A server's markdown as elements, nothing of it taken as HTML: fenced code
 * highlighted in its language, `code` in its own look, the rest as text.
 */
export function markupElement(contents: Markup | null | undefined): HTMLElement | null {
  if (!contents) return null
  const parts = Array.isArray(contents) ? contents : [contents]
  const box = document.createElement('div')
  box.className = 'lsp-doc'
  for (const part of parts) {
    if (typeof part === 'string') appendMarkdown(box, part)
    else if ('language' in part && part.language) appendCode(box, part.value, part.language)
    else appendMarkdown(box, part.value)
  }
  return box.textContent?.trim() ? box : null
}

function appendCode(box: HTMLElement, code: string, language: string): void {
  const pre = document.createElement('pre')
  pre.className = 'lsp-code'
  // syntax's HTML: every piece of the text escaped, spans of its own classes only.
  pre.innerHTML = highlight(code.replace(/\n$/, ''), language || 'text')
  box.append(pre)
}

function appendMarkdown(box: HTMLElement, text: string): void {
  const fence = /^```([\w+-]*)\n([\s\S]*?)^```[ \t]*$/gm
  let last = 0
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    appendText(box, text.slice(last, m.index))
    appendCode(box, m[2]!, m[1] || 'text')
    last = m.index + m[0].length
  }
  appendText(box, text.slice(last))
}

function appendText(box: HTMLElement, text: string): void {
  for (const para of text.split(/\n{2,}/)) {
    if (!para.trim()) continue
    let p: HTMLElement | null = null
    let hardBreak = false
    for (const raw of para.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      // A line ending in two spaces (or a backslash): the next starts a line of its own.
      const broke = hardBreak
      hardBreak = / {2,}$|\\$/.test(raw)
      // A rule between parts: a line across.
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
        box.append(document.createElement('hr'))
        p = null
        continue
      }
      const heading = /^#{1,6}\s+(.*)$/.exec(line)
      const item = /^[-*+]\s+(.*)$/.exec(line)
      // A heading and a list's item on lines of their own; other lines run on, as Markdown joins them.
      if (!p || heading || item || p.dataset.block || broke) {
        p = document.createElement('p')
        box.append(p)
      } else p.append(' ')
      if (heading) {
        p.dataset.block = 'heading'
        const b = document.createElement('strong')
        appendInline(b, heading[1]!)
        p.append(b)
      } else if (item) {
        p.dataset.block = 'item'
        p.append('• ')
        appendInline(p, item[1]!)
      } else appendInline(p, line.replace(/\\$/, ''))
    }
  }
}

/** `code` and **strong** in their look; links as their text; the rest as it is. */
function appendInline(p: HTMLElement, text: string): void {
  for (const piece of text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').split(/(`[^`]+`|\*\*[^*]+\*\*)/)) {
    if (!piece) continue
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 1) {
      const c = document.createElement('code')
      c.textContent = piece.slice(1, -1)
      p.append(c)
    } else if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 3) {
      const b = document.createElement('strong')
      b.textContent = piece.slice(2, -2)
      p.append(b)
    } else p.append(piece.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1'))
  }
}

// What the server knows, asked -----------------------------------------------------

export async function hoverAt(b: LspBinding, pos: number): Promise<HTMLElement | null> {
  if (!b.has('hoverProvider')) return null
  const r = await b.request<{ contents: Markup }>('textDocument/hover', b.at(pos))
  return markupElement(r?.contents)
}

interface SignatureHelp {
  signatures: { label: string; documentation?: Markup; parameters?: { label: string | [number, number] }[]; activeParameter?: number }[]
  activeSignature?: number
  activeParameter?: number
}

export async function signatureAt(b: LspBinding, pos: number, explicit: boolean): Promise<HTMLElement | null> {
  if (!b.has('signatureHelpProvider')) return null
  const r = await b.request<SignatureHelp>('textDocument/signatureHelp', { ...b.at(pos), context: { triggerKind: explicit ? 1 : 2, isRetrigger: false } })
  const sig = r?.signatures?.[r.activeSignature ?? 0]
  if (!sig) return null
  const box = document.createElement('div')
  box.className = 'lsp-signature'
  const head = document.createElement('div')
  head.className = 'lsp-code'
  const active = sig.activeParameter ?? r!.activeParameter ?? 0
  const param = sig.parameters?.[active]?.label
  let range: [number, number] | null = null
  if (Array.isArray(param)) range = param
  else if (typeof param === 'string') {
    const at = sig.label.indexOf(param)
    if (at >= 0) range = [at, at + param.length]
  }
  if (range) {
    const strong = document.createElement('strong')
    strong.textContent = sig.label.slice(range[0], range[1])
    head.append(sig.label.slice(0, range[0]), strong, sig.label.slice(range[1]))
  } else head.textContent = sig.label
  box.append(head)
  const doc = markupElement(sig.documentation)
  if (doc) box.append(doc)
  return box
}

type LocationLike = { uri: string; range: LspRange } | { targetUri: string; targetSelectionRange?: LspRange; targetRange: LspRange }

export function locations(result: unknown): LspLocation[] {
  if (!result) return []
  const list = (Array.isArray(result) ? result : [result]) as LocationLike[]
  return list.flatMap((l) => {
    const uri = 'targetUri' in l ? l.targetUri : l.uri
    const range = 'targetUri' in l ? (l.targetSelectionRange ?? l.targetRange) : l.range
    const path = pathOfUri(uri)
    return path ? [{ path, range }] : []
  })
}

export async function definitionAt(b: LspBinding, pos: number): Promise<LspLocation[]> {
  if (!b.has('definitionProvider')) return []
  return locations(await b.request('textDocument/definition', b.at(pos)))
}

export async function referencesAt(b: LspBinding, pos: number): Promise<LspLocation[]> {
  if (!b.has('referencesProvider')) return []
  return locations(await b.request('textDocument/references', { ...b.at(pos), context: { includeDeclaration: true } }))
}

const COMPLETION_KIND: Record<number, string> = {
  1: 'text', 2: 'method', 3: 'function', 4: 'constructor', 5: 'field', 6: 'variable', 7: 'class', 8: 'interface', 9: 'module', 10: 'property',
  11: 'unit', 12: 'value', 13: 'enum', 14: 'keyword', 15: 'snippet', 16: 'color', 17: 'file', 18: 'reference', 19: 'folder', 20: 'enumMember',
  21: 'constant', 22: 'struct', 23: 'event', 24: 'operator', 25: 'typeParameter',
}

interface LspCompletionItem {
  label: string
  kind?: number
  detail?: string
  insertText?: string
  insertTextFormat?: number
  textEdit?: { range: LspRange; newText: string } | { insert: LspRange; replace: LspRange; newText: string }
  sortText?: string
  filterText?: string
}

/** The server's completions at the cursor, as the editor's items (snippets kept, ranges of their own). */
export async function completionsAt(b: LspBinding, pos: number, explicit: boolean, prefix: string): Promise<CompletionItem[] | null> {
  if (!b.has('completionProvider')) return null
  const r = await b.request<LspCompletionItem[] | { items: LspCompletionItem[] }>('textDocument/completion', {
    ...b.at(pos),
    context: { triggerKind: explicit ? 1 : 1 },
  })
  if (!r) return null
  const items = (Array.isArray(r) ? r : r.items).slice()
  items.sort((x, y) => (x.sortText ?? x.label).localeCompare(y.sortText ?? y.label))
  const lower = prefix.toLowerCase()
  return items
    .filter((i) => !lower || (i.filterText ?? i.label).toLowerCase().includes(lower))
    .slice(0, 200)
    .map((i): CompletionItem => {
      const edit = i.textEdit
      const range = edit ? ('range' in edit ? edit.range : edit.replace) : null
      const text = edit?.newText ?? i.insertText ?? i.label
      const snippet = i.insertTextFormat === 2
      return {
        label: i.label,
        ...(i.detail ? { detail: i.detail } : {}),
        kind: COMPLETION_KIND[i.kind ?? 0] ?? 'text',
        ...(snippet ? { snippet: text } : { insert: text }),
        ...(range ? { from: b.offset(range.start), to: b.offset(range.end) } : {}),
      }
    })
}

export async function formattingEdits(b: LspBinding): Promise<TextEdit[] | null> {
  if (!b.has('documentFormattingProvider')) return null
  const { indentUnit, tabSize } = b.editor.indentation
  return b.request<TextEdit[]>('textDocument/formatting', {
    options: { tabSize: indentUnit === '\t' ? tabSize : indentUnit.length, insertSpaces: indentUnit !== '\t' },
  })
}

/** Text edits of a server as one transaction of the editor. */
export function applyTextEdits(b: LspBinding, edits: readonly TextEdit[], userEvent = 'input.lsp'): void {
  if (edits.length === 0) return
  b.editor.dispatch({
    changes: edits.map((e) => ({ from: b.offset(e.range.start), to: b.offset(e.range.end), insert: e.newText })),
    userEvent,
  })
}

const SYMBOL_KIND: Record<number, SymbolKind> = {
  2: 'module', 3: 'namespace', 4: 'namespace', 5: 'class', 6: 'method', 7: 'property', 8: 'property', 9: 'constructor', 10: 'enum',
  11: 'interface', 12: 'function', 13: 'variable', 14: 'constant', 15: 'variable', 16: 'variable', 17: 'variable', 18: 'variable',
  19: 'key', 20: 'key', 21: 'constant', 22: 'constant', 23: 'struct', 24: 'function', 25: 'function', 26: 'type',
}

interface DocumentSymbol {
  name: string
  kind: number
  range: LspRange
  selectionRange: LspRange
  children?: DocumentSymbol[]
}

/** The file's symbols from its server, as syntax's tree (null when the server has none to give). */
export async function documentSymbols(b: LspBinding): Promise<SymbolNode[] | null> {
  if (!b.has('documentSymbolProvider')) return null
  const r = await b.request<(DocumentSymbol | { name: string; kind: number; location: { range: LspRange } })[]>('textDocument/documentSymbol')
  if (!r) return null
  const node = (s: DocumentSymbol): SymbolNode => ({
    name: s.name,
    kind: SYMBOL_KIND[s.kind] ?? 'variable',
    line: s.selectionRange.start.line + 1,
    column: s.selectionRange.start.character + 1,
    endLine: s.range.end.line + 1,
    children: (s.children ?? []).map(node).sort((x, y) => x.line - y.line),
  })
  if (r.every((s) => 'selectionRange' in s)) return (r as DocumentSymbol[]).map(node).sort((x, y) => x.line - y.line)
  // Flat symbols: nested by their ranges.
  const flat = (r as { name: string; kind: number; location: { range: LspRange } }[])
    .map((s) => ({ name: s.name, kind: SYMBOL_KIND[s.kind] ?? 'variable', line: s.location.range.start.line + 1, column: s.location.range.start.character + 1, endLine: s.location.range.end.line + 1, children: [] as SymbolNode[] }))
    .sort((x, y) => x.line - y.line || y.endLine - x.endLine)
  const roots: SymbolNode[] = []
  const stack: SymbolNode[] = []
  for (const s of flat) {
    while (stack.length && !(stack[stack.length - 1]!.line <= s.line && s.endLine <= stack[stack.length - 1]!.endLine)) stack.pop()
    ;(stack.length ? stack[stack.length - 1]!.children : roots).push(s)
    stack.push(s)
  }
  return roots
}

// Workspace edits (a rename's, an action's) -----------------------------------------

interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>
  documentChanges?: ({ textDocument: { uri: string }; edits: TextEdit[] } | { kind: string })[]
}

/**
 * A workspace edit applied: a file open in a code editor through it (one undo
 * a file), another written on disk. Files made, renamed or removed by it are
 * left alone (not asked for by folio's capabilities). True when every file
 * took its edits.
 */
export async function applyWorkspaceEdit(
  edit: WorkspaceEdit | null | undefined,
  editorOf: (path: string) => LspBinding | null,
  writeFile: (path: string, edits: { from: LspPosition; to: LspPosition; text: string }[]) => Promise<boolean>,
): Promise<boolean> {
  if (!edit) return false
  const byPath = new Map<string, TextEdit[]>()
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const path = pathOfUri(uri)
    if (path) byPath.set(path, [...(byPath.get(path) ?? []), ...edits])
  }
  for (const c of edit.documentChanges ?? []) {
    if (!('textDocument' in c)) continue
    const path = pathOfUri(c.textDocument.uri)
    if (path) byPath.set(path, [...(byPath.get(path) ?? []), ...c.edits])
  }
  let all = true
  for (const [path, edits] of byPath) {
    const b = editorOf(path)
    if (b) applyTextEdits(b, edits, 'input.lsp')
    else {
      // On disk: the last edit first, so each range is still where the server meant it.
      const sorted = [...edits].sort((x, y) => y.range.start.line - x.range.start.line || y.range.start.character - x.range.start.character)
      all = (await writeFile(path, sorted.map((e) => ({ from: e.range.start, to: e.range.end, text: e.newText })))) && all
    }
  }
  return all
}
