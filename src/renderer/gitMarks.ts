/**
 * A file's changes against its last commit, in the code editor's gutter
 * (ADR-002, I1): added, changed and deleted lines marked as they are typed;
 * a click on a mark shows what the lines were and takes the change back.
 */
import type { CodeEditor } from '@dskripchenko/code-editor'
import { diffLines } from './diff'

/** A run of changed lines: where it is now, how many lines it has now, and the lines it had. */
export interface Hunk {
  /** 0-based, in the text as it is now. */
  start: number
  count: number
  old: string[]
}

const lf = (text: string) => text.replace(/\r\n?/g, '\n')

/** The runs of change between the committed text and the text now. */
export function hunksOf(committed: string, now: string): Hunk[] {
  const out: Hunk[] = []
  let line = 0
  let open: Hunk | null = null
  for (const d of diffLines(lf(committed), lf(now))) {
    if (d.kind === 'same') {
      if (open) out.push(open)
      open = null
      line++
      continue
    }
    open ??= { start: line, count: 0, old: [] }
    if (d.kind === 'add') {
      open.count++
      line++
    } else open.old.push(d.text)
  }
  if (open) out.push(open)
  return out
}

export type MarkKind = 'added' | 'modified' | 'deleted'

/** The gutter's marks for the runs: each line added or changed, a deletion on the line before it. */
export function marksOf(hunks: readonly Hunk[]): { line: number; kind: MarkKind }[] {
  const out: { line: number; kind: MarkKind }[] = []
  for (const h of hunks) {
    if (h.count === 0) out.push({ line: Math.max(0, h.start - 1), kind: 'deleted' })
    else for (let i = 0; i < h.count; i++) out.push({ line: h.start + i, kind: h.old.length ? 'modified' : 'added' })
  }
  return out
}

/** The run a marked line belongs to. */
export function hunkAt(hunks: readonly Hunk[], line: number): Hunk | null {
  return hunks.find((h) => (h.count === 0 ? Math.max(0, h.start - 1) === line : line >= h.start && line < h.start + h.count)) ?? null
}

/** The change that takes a run back to what it was, as offsets of the text now. */
export function revertOf(doc: { lineCount: number; lineStart(i: number): number; lineEnd(i: number): number; length: number }, h: Hunk): { from: number; to: number; insert: string } {
  const old = h.old.join('\n')
  if (h.count === 0) {
    // Deleted lines: back before the line now at their place (or after the last line).
    if (h.start < doc.lineCount) return { from: doc.lineStart(h.start), to: doc.lineStart(h.start), insert: old + '\n' }
    return { from: doc.length, to: doc.length, insert: '\n' + old }
  }
  const last = h.start + h.count - 1
  if (h.old.length) return { from: doc.lineStart(h.start), to: doc.lineEnd(last), insert: old }
  // Added lines: gone, with a line break (the one after them, or before them at the end).
  if (last + 1 < doc.lineCount) return { from: doc.lineStart(h.start), to: doc.lineStart(last + 1), insert: '' }
  return { from: h.start > 0 ? doc.lineEnd(h.start - 1) : 0, to: doc.length, insert: '' }
}

export interface GitMarksText {
  /** `Changed lines` / `Deleted lines` / `Added lines` above what they were. */
  was: string
  added: string
  revert: string
}

/** Keeps an editor's marks up to date with its text, and answers a click on one. */
export class GitMarks {
  private hunks: Hunk[] = []
  /** The marks last set: the same again changes nothing (the gutter is not drawn again under the pointer). */
  private shown = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private popover: HTMLElement | null = null
  private readonly off: (() => void)[] = []

  constructor(
    private readonly editor: CodeEditor,
    private committed: string,
    private readonly text: () => GitMarksText,
  ) {
    const changed = () => this.soon()
    const clicked = (e: Event) => this.peek((e as CustomEvent<{ line: number; rect: DOMRect }>).detail)
    editor.dom.addEventListener('dsk:change', changed)
    editor.dom.addEventListener('dsk:gutter-mark', clicked)
    this.off.push(
      () => editor.dom.removeEventListener('dsk:change', changed),
      () => editor.dom.removeEventListener('dsk:gutter-mark', clicked),
    )
    this.update()
  }

  /** A commit made: the text marks are counted from changes. */
  setCommitted(text: string): void {
    this.committed = text
    this.update()
  }

  destroy(): void {
    for (const f of this.off) f()
    this.close()
    if (this.timer) clearTimeout(this.timer)
  }

  private soon(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.update(), 250)
  }

  private update(): void {
    this.timer = null
    this.hunks = hunksOf(this.committed, this.editor.value)
    const marks = marksOf(this.hunks)
    const key = JSON.stringify(marks)
    if (key === this.shown) return
    this.shown = key
    this.editor.setGutterMarks(marks, 'git')
  }

  private close(): void {
    this.popover?.remove()
    this.popover = null
  }

  /** What a marked run was, beside it, with a way back. */
  private peek(detail: { line: number; rect: DOMRect }): void {
    this.close()
    const hunk = hunkAt(this.hunks, detail.line)
    if (!hunk) return
    const t = this.text()
    const box = document.createElement('div')
    box.className = 'git-peek'
    box.dataset.testid = 'git-peek'
    const head = document.createElement('div')
    head.className = 'git-peek-head'
    const label = document.createElement('span')
    label.textContent = hunk.old.length ? t.was : t.added
    const revert = document.createElement('button')
    revert.type = 'button'
    revert.className = 'git-peek-revert'
    revert.dataset.testid = 'git-revert'
    revert.textContent = t.revert
    revert.addEventListener('click', () => {
      const change = revertOf(this.editor.state.doc, hunk)
      this.editor.dispatch({ changes: change, userEvent: 'input.revert' })
      this.close()
      this.update()
      this.editor.focus()
    })
    head.append(label, revert)
    box.append(head)
    if (hunk.old.length) {
      const pre = document.createElement('pre')
      pre.className = 'git-peek-old'
      pre.textContent = hunk.old.join('\n')
      box.append(pre)
    }
    box.style.left = `${detail.rect.right + 4}px`
    box.style.top = `${detail.rect.bottom}px`
    document.body.append(box)
    this.popover = box
    // Away from it, or Escape: closed.
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.contains(e.target as Node)) {
        this.close()
        document.removeEventListener('mousedown', away, true)
        document.removeEventListener('keydown', away, true)
      }
    }
    setTimeout(() => {
      document.addEventListener('mousedown', away, true)
      document.addEventListener('keydown', away, true)
    })
  }
}
