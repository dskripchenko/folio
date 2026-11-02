/**
 * `[[Links]]` between notes in the window: the ones naming no file are shown
 * as missing, the editor suggests notes after `[[`, and a heading a link
 * names is scrolled to once the note it opens is drawn.
 */
import { rank } from './fuzzy'

type Exists = (from: string, targets: string[]) => Promise<boolean[]>

/**
 * A pane's links checked whenever what it shows changes (a redraw, typing in
 * the editor): a link to no file gets `is-missing`, as the kit styles it.
 * The check, for running again when files may have come or gone.
 */
export function watchWikiLinks(pane: HTMLElement, pathOf: () => string | null, exists: Exists): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const check = async (): Promise<void> => {
    const from = pathOf()
    const links = [...pane.querySelectorAll<HTMLAnchorElement>('a[data-wikilink]')]
    if (!from || links.length === 0) return
    const found = await exists(from, links.map((a) => a.dataset.wikilink ?? ''))
    links.forEach((a, i) => a.classList.toggle('is-missing', found[i] === false))
  }
  // Only the tree's shape is watched, so marking the links does not start it again.
  new MutationObserver(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void check(), 250)
  }).observe(pane, { childList: true, subtree: true, characterData: true })
  return () => void check()
}

export interface LinkSuggestion {
  label: string
  insert: string
  detail?: string
}

/**
 * What the editor offers after `[[`: the files of the note's root, best
 * matches first. The list is asked for once per `[[` typed and kept briefly.
 */
export function linkSuggester(pathOf: () => string | null, names: (from: string) => Promise<{ name: string; path: string }[]>): (query: string) => Promise<LinkSuggestion[]> {
  let cache: { from: string; at: number; list: Promise<{ name: string; path: string }[]> } | null = null
  return async (query) => {
    const from = pathOf()
    if (!from) return []
    if (!cache || cache.from !== from || Date.now() - cache.at > 5000) cache = { from, at: Date.now(), list: names(from) }
    const list = await cache.list
    const ranked = query === '' ? list.slice(0, 50).map((item) => ({ item })) : rank(query, list, (n) => n.path, 50)
    return ranked.map(({ item }) => ({ label: item.name.split('/').pop() ?? item.name, insert: item.name, detail: item.path }))
  }
}

/** Scroll to the heading a link named, once the note's view has drawn it. */
export function revealHeading(pane: HTMLElement, heading: string, scroller: HTMLElement): void {
  const slug = slugOf(heading)
  const started = Date.now()
  const tryNow = (): void => {
    const target = [...pane.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].find((h) => h.id === slug || slugOf(h.textContent ?? '') === slug)
    if (target) {
      scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
      return
    }
    if (Date.now() - started < 3000) setTimeout(tryNow, 100)
  }
  tryNow()
}

/** A heading's slug, by the kit's rule for its ids and links. */
export function slugOf(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  )
}
