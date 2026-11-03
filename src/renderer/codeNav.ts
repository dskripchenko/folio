/**
 * Finding one's way in code (ADR-002, I2): the symbols of the file in the
 * code editor — read again once typing pauses — for the outline beside the
 * page, the breadcrumbs above the text (the file's folders, then the
 * symbols holding the caret) and going to a symbol by name.
 */
import type { CodeEditor } from '@dskripchenko/code-editor'
import { symbolPath, symbols, type SymbolKind, type SymbolNode } from '@dskripchenko/syntax'
import type { Heading } from './outline'

/** A symbol as the outline and the palette list it. */
export interface NavItem extends Heading {
  kind: SymbolKind
  /** 1-based, as `line` is 0-based (the outline's). */
  column: number
  endLine: number
  /** The names of the symbols holding it (`Class.method`'s `Class`). */
  container: string
}

/** The tree, depth first, as outline items. */
export function navItems(tree: readonly SymbolNode[], depth = 1, parents: string[] = []): NavItem[] {
  const out: NavItem[] = []
  for (const s of tree) {
    out.push({ level: depth, text: s.name, line: s.line - 1, kind: s.kind, column: s.column, endLine: s.endLine - 1, container: parents.join('.') })
    out.push(...navItems(s.children, depth + 1, [...parents, s.name]))
  }
  return out
}

/** Past this many characters the symbols are not read (as the editor's own folding). */
const LIMIT = 2_000_000

export class CodeNav {
  private tree: SymbolNode[] = []
  items: NavItem[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly off: (() => void)[] = []

  constructor(
    readonly editor: CodeEditor,
    private readonly language: string | null,
    /** The breadcrumbs' element, above the text. */
    private readonly crumbs: HTMLElement,
    /** The file's place: its project (or Shared) and folders, then its name. */
    private readonly place: string[],
    /** Told when the symbols changed (the outline draws them again). */
    private readonly changed: () => void,
    /** Symbols of another source (a language server's), over the patterns' when it gives some. */
    private readonly source?: () => Promise<SymbolNode[] | null>,
  ) {
    const soon = () => this.soon()
    const moved = () => this.draw()
    editor.dom.addEventListener('dsk:change', soon)
    editor.dom.addEventListener('dsk:selection', moved)
    this.off.push(
      () => editor.dom.removeEventListener('dsk:change', soon),
      () => editor.dom.removeEventListener('dsk:selection', moved),
    )
    this.read()
  }

  destroy(): void {
    for (const f of this.off) f()
    if (this.timer) clearTimeout(this.timer)
  }

  /** The line (0-based) of the caret. */
  caretLine(): number {
    const { doc, selection } = this.editor.state
    return doc.lineAt(selection.main.head).index
  }

  /** The innermost symbol holding the caret, as an index of `items`; -1 outside every one. */
  current(): number {
    const path = symbolPath(this.tree, this.caretLine() + 1)
    const last = path[path.length - 1]
    return last ? this.items.findIndex((i) => i.line === last.line - 1 && i.text === last.name) : -1
  }

  go(item: { line: number; column: number }): void {
    this.editor.goToLine(item.line + 1, item.column)
  }

  private soon(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.read(), 300)
  }

  /** Read again now (a language server came). */
  refresh(): void {
    this.read()
  }

  private read(): void {
    this.timer = null
    const text = this.editor.state.doc.length <= LIMIT && this.language ? this.editor.value : ''
    this.take(text ? symbols(text, this.language!) : [])
    // The server's, when it answers: more exact than the patterns.
    void this.source?.().then((tree) => {
      if (tree && tree.length) this.take(tree)
    })
  }

  private take(tree: SymbolNode[]): void {
    this.tree = tree
    const next = navItems(this.tree)
    const same = JSON.stringify(next) === JSON.stringify(this.items)
    this.items = next
    this.draw()
    if (!same) this.changed()
  }

  /** The breadcrumbs: the file's place, then the symbols holding the caret (each a way to it). */
  private draw(): void {
    const parts: HTMLElement[] = this.place.map((p, i) => {
      const s = document.createElement('span')
      s.className = i === this.place.length - 1 ? 'crumb crumb-file' : 'crumb'
      s.textContent = p
      return s
    })
    for (const s of symbolPath(this.tree, this.caretLine() + 1)) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `crumb crumb-symbol crumb-${s.kind}`
      b.dataset.testid = 'crumb'
      b.textContent = s.name
      b.addEventListener('click', () => this.go({ line: s.line - 1, column: s.column }))
      parts.push(b)
    }
    const key = parts.map((p) => p.textContent).join('\u0000')
    if (this.crumbs.dataset.key === key) return
    this.crumbs.dataset.key = key
    this.crumbs.replaceChildren(...parts)
  }
}
