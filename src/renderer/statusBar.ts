/**
 * The status line under the page: how long the document in view is (words,
 * characters, minutes to read it), and in the Markdown source where the caret
 * is (line and column).
 */
import { languages } from '@dskripchenko/syntax'
import { plural } from './searchPanel'

/** A language's name for people (`TypeScript`), by its id or alias. */
function languageName(language: string | null): string | null {
  if (!language) return null
  const l = language.toLowerCase()
  return languages().find((x) => x.id === l || x.aliases.includes(l))?.name ?? null
}

export interface StatusText {
  words: [string, string, string] | [string, string]
  chars: [string, string, string] | [string, string]
  /** `~{n} min` */
  read: string
  /** `Ln {line}, Col {col}` */
  caret: string
  /** `Spaces: {n}`, `Tab: {n}`: what Tab inserts in the code editor. */
  spaces: string
  tabs: string
  /** The language of a text with none. */
  plain: string
}

/** What the status line shows of a code editor (`@dskripchenko/code-editor`). */
interface EditorLike {
  readonly state: { doc: { lineAt(pos: number): { index: number; from: number } }; selection: { main: { head: number } } }
  readonly indentation: { tabSize: number; indentUnit: string }
  readonly language: string | null
  readonly selection: { anchor: number; head: number }[]
  readonly lineBreak: '\n' | '\r\n'
}

/** Words and characters of a document's text, its front matter, code fences and markup left out. */
export function countText(text: string): { words: number; chars: number } {
  const body = text
    .replace(/^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/, '')
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|$(?![\s\S]))/gm, '')
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~=|-]+/g, ' ')
  const words = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
  const chars = body.replace(/\s+/g, ' ').trim().length
  return { words, chars }
}

/** The line and column (from 1) of a place in a text. */
export function lineCol(text: string, at: number): { line: number; col: number } {
  const before = text.slice(0, at)
  const line = before.split('\n').length
  return { line, col: at - before.lastIndexOf('\n') }
}

export class StatusBar {
  constructor(
    private readonly el: HTMLElement,
    private text: StatusText,
  ) {}

  setText(text: StatusText): void {
    this.text = text
  }

  /**
   * A file edited in the code editor: where the caret is, what Tab inserts,
   * the line breaks and the language (as in a code editor's status line).
   */
  showEditor(editor: EditorLike, server: string | null = null): void {
    this.el.hidden = false
    const { doc, selection } = editor.state
    const head = selection.main.head
    const line = doc.lineAt(head)
    const { indentUnit, tabSize } = editor.indentation
    const parts = [
      this.text.caret.replace('{line}', String(line.index + 1)).replace('{col}', String(head - line.from + 1)),
      indentUnit === '\t' ? this.text.tabs.replace('{n}', String(tabSize)) : this.text.spaces.replace('{n}', String(indentUnit.length)),
      editor.lineBreak === '\r\n' ? 'CRLF' : 'LF',
      languageName(editor.language) ?? this.text.plain,
      ...(server ? [server] : []),
    ]
    this.el.textContent = parts.join(' · ')
  }

  /** The document in view: its text, and the source field when it is the one being written in. */
  show(doc: { text: string; field: HTMLTextAreaElement | null } | null): void {
    if (!doc) {
      this.el.hidden = true
      return
    }
    this.el.hidden = false
    const { words, chars } = countText(doc.text)
    const parts = [plural(words, this.text.words), plural(chars, this.text.chars), this.text.read.replace('{n}', String(Math.max(1, Math.round(words / 200))))]
    if (doc.field) {
      const { line, col } = lineCol(doc.field.value, doc.field.selectionStart)
      parts.push(this.text.caret.replace('{line}', String(line)).replace('{col}', String(col)))
    }
    this.el.textContent = parts.join(' · ')
  }
}
