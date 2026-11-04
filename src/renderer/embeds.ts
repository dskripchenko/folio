/**
 * Embedded notes: `![[Note]]` and `![[Note#Heading]]` drawn in the note that
 * names them — the whole note, or the heading's section. Filled when read (in
 * the editor an embed stays its link); an embed inside an embed is filled too,
 * three deep at most, and never the note it is in (a loop stays a link).
 */
import { slugOf } from './wikilinks'
import type { Peeked } from './hoverPreview'

const DEPTH = 3

/** The section of a heading: from its line up to the next heading of its level or above. */
export function sectionOf(text: string, heading: string): string | null {
  const lines = text.split('\n')
  const want = slugOf(heading)
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(lines[i]!)) fence = !fence
    if (fence) continue
    const h = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[i]!)
    if (!h || slugOf(h[2]!.replace(/[*_`~]/g, '')) !== want) continue
    const level = h[1]!.length
    let end = lines.length
    let inner = false
    for (let j = i + 1; j < lines.length; j++) {
      if (/^ {0,3}(`{3,}|~{3,})/.test(lines[j]!)) inner = !inner
      if (inner) continue
      const next = /^ {0,3}(#{1,6})[ \t]/.exec(lines[j]!)
      if (next && next[1]!.length <= level) {
        end = j
        break
      }
    }
    return lines.slice(i, end).join('\n').trim()
  }
  return null
}

export interface EmbedDeps {
  peek(from: string, link: { wiki: string }): Promise<Peeked | null>
  /** The note drawn as when read. */
  draw(note: Peeked, text: string): HTMLElement
  /** A picture, a video or a sound, at a size (`![[a.png|300]]`, `|300x200`) or its own. */
  media(file: Peeked, size: { width?: number; height?: number }): HTMLElement
}

/** `300` or `300x200` (the kit's `data-size`, Obsidian's way of sizing an embed). */
export function embedSize(raw: string | undefined): { width?: number; height?: number } {
  const m = raw ? /^(\d+)(?:x(\d+))?$/.exec(raw) : null
  return m ? { width: Number(m[1]), ...(m[2] ? { height: Number(m[2]) } : {}) } : {}
}

/** Fill a pane's embeds as they appear; `pathOf` is the note the pane shows. */
export function watchEmbeds(pane: HTMLElement, pathOf: () => string | null, deps: EmbedDeps): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const fill = async (): Promise<void> => {
    const from = pathOf()
    if (!from) return
    // ![[picture.png]]: the kit guessed its address beside the note; found by name as a link is (anywhere in the root).
    for (const img of [...pane.querySelectorAll<HTMLImageElement>('img.uid-markdown__embed-image[data-embed]:not([data-state])')]) {
      if (img.closest('[contenteditable="true"]')) continue
      img.dataset.state = 'loading'
      const container = img.closest<HTMLElement>('.uid-markdown__embed[data-path]')
      const file = await deps.peek(container?.dataset.path ?? from, { wiki: img.dataset.embed! })
      if (!file?.media) {
        img.dataset.state = 'missing'
        continue
      }
      img.dataset.state = 'filled'
      img.replaceWith(deps.media(file, embedSize(img.dataset.size)))
    }
    for (const el of [...pane.querySelectorAll<HTMLElement>('.uid-markdown__embed[data-embed]:not([data-state])')]) {
      if (el.closest('[contenteditable="true"]')) continue
      el.dataset.state = 'loading'
      // The notes it is inside: the pane's own, then each embed around it.
      const chain = [from, ...[...ancestors(el)].map((a) => a.dataset.path!).filter(Boolean)]
      const container = el.parentElement?.closest<HTMLElement>('.uid-markdown__embed[data-path]')
      const note = await deps.peek(container?.dataset.path ?? from, { wiki: el.dataset.embed! })
      // A picture, a video, a sound: drawn as itself.
      if (note?.media) {
        el.dataset.state = 'filled'
        el.dataset.path = note.path
        el.classList.add('is-filled', 'is-media')
        el.replaceChildren(deps.media(note, embedSize(el.dataset.size)))
        continue
      }
      if (!note || chain.includes(note.path) || chain.length > DEPTH) {
        el.dataset.state = note ? 'loop' : 'missing'
        continue
      }
      const text = note.heading ? sectionOf(note.text, note.heading) : note.text.replace(/^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/, '')
      if (text === null) {
        el.dataset.state = 'missing'
        continue
      }
      el.dataset.state = 'filled'
      el.dataset.path = note.path
      el.classList.add('is-filled')
      const link = el.querySelector('a')
      const body = document.createElement('div')
      body.className = 'embed-body'
      body.append(deps.draw(note, text))
      el.replaceChildren(...(link ? [link] : []), body)
    }
  }
  new MutationObserver(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void fill(), 120)
  }).observe(pane, { childList: true, subtree: true })
}

function* ancestors(el: HTMLElement): Generator<HTMLElement> {
  let at = el.parentElement?.closest<HTMLElement>('.uid-markdown__embed')
  while (at) {
    yield at
    at = at.parentElement?.closest<HTMLElement>('.uid-markdown__embed')
  }
}
