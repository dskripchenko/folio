/**
 * The status line under the page: how long the document in view is (words,
 * characters, minutes to read it), and in the Markdown source where the caret
 * is (line and column).
 */
import { plural } from './searchPanel'

export interface StatusText {
  words: [string, string, string] | [string, string]
  chars: [string, string, string] | [string, string]
  /** `~{n} min` */
  read: string
  /** `Ln {line}, Col {col}` */
  caret: string
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
