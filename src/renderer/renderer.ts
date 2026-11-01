/**
 * The window: tabs of open documents, each a `<dsk-markdown>` of embed with
 * its relative paths on `folio://`, and the network consent banner.
 */
interface Opened {
  path: string
  name: string
  text: string
  base: string
  folder: string
  owner: 'shared' | 'project' | 'file'
  project: string | null
}
type OpenResult = Opened | { error: string; path: string }

interface FolioBridge {
  platform: string
  startup(): Promise<{ documents: OpenResult[]; active: string | null; locale: string }>
  openDialog(): Promise<OpenResult[]>
  open(path: string): Promise<OpenResult>
  openUrl(url: string): Promise<OpenResult>
  external(url: string): void
  pathOf(file: File): string
  state(documents: string[], active: string | null): void
  allowNetwork(scope: 'file' | 'folder', path: string): Promise<boolean>
  onOpened(cb: (value: unknown) => void): () => void
  onBlocked(cb: (value: unknown) => void): () => void
  onCloseTab(cb: (value: unknown) => void): () => void
}

declare global {
  interface Window {
    folio: FolioBridge
    DskEmbed?: { configure(options: Record<string, unknown>): void }
  }
}

const TEXT = {
  en: {
    open: 'Open…',
    welcome: 'Open a Markdown file — or drop it here.',
    blocked: 'This document wants to load from the web: {hosts}. Nothing was sent.',
    allowFile: 'Allow for this file',
    allowFolder: 'Allow for its folder',
    close: 'Close',
  },
  ru: {
    open: 'Открыть…',
    welcome: 'Откройте Markdown-файл — или перетащите его сюда.',
    blocked: 'Документ хочет загрузить из сети: {hosts}. Ничего не отправлено.',
    allowFile: 'Разрешить для файла',
    allowFolder: 'Разрешить для его папки',
    close: 'Закрыть',
  },
}

const folio = window.folio
document.documentElement.dataset.platform = folio.platform

let t = TEXT.en
const tabsEl = document.querySelector<HTMLElement>('.tabs')!
const viewEl = document.querySelector<HTMLElement>('.view')!
const welcomeEl = document.querySelector<HTMLElement>('.welcome')!
const bannerEl = document.querySelector<HTMLElement>('.banner')!

interface Tab {
  path: string
  result: OpenResult
  pane: HTMLElement
  button: HTMLButtonElement
  blocked: string[]
}

const tabs: Tab[] = []
let active: Tab | null = null

function applyText(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as keyof typeof t
    el.textContent = t[key]
  }
}

function isOpened(r: OpenResult): r is Opened {
  return !('error' in r)
}

/** The document's view: embed's markdown, its relative paths against its folder. */
function render(pane: HTMLElement, doc: Opened): void {
  pane.replaceChildren()
  const md = document.createElement('dsk-markdown')
  md.setAttribute('image-base', doc.base)
  md.setAttribute('link-base', doc.base)
  md.setAttribute('toc', '')
  const source = document.createElement('script')
  source.type = 'text/markdown'
  // textContent, not markup: a `</script>` in the text stays text.
  source.textContent = doc.text
  md.append(source)
  pane.append(md)
}

function report(): void {
  folio.state(
    tabs.filter((tab) => isOpened(tab.result)).map((tab) => tab.path),
    active && isOpened(active.result) ? active.path : null,
  )
}

function showBanner(): void {
  if (!active || active.blocked.length === 0) {
    bannerEl.hidden = true
    return
  }
  bannerEl.querySelector('.banner-text')!.textContent = t.blocked.replace('{hosts}', active.blocked.join(', '))
  bannerEl.hidden = false
}

function activate(tab: Tab | null): void {
  active = tab
  for (const other of tabs) {
    other.pane.hidden = other !== tab
    other.button.setAttribute('aria-selected', String(other === tab))
  }
  welcomeEl.hidden = tab !== null
  showBanner()
  report()
}

function close(tab: Tab): void {
  const i = tabs.indexOf(tab)
  if (i < 0) return
  tabs.splice(i, 1)
  tab.pane.remove()
  tab.button.remove()
  if (active === tab) activate(tabs[Math.min(i, tabs.length - 1)] ?? null)
  else report()
}

function add(result: OpenResult, focus = true): void {
  const existing = tabs.find((tab) => tab.path === result.path)
  if (existing) {
    if (focus) activate(existing)
    return
  }
  const pane = document.createElement('article')
  pane.className = 'doc'
  pane.dataset.path = result.path
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tab'
  button.setAttribute('role', 'tab')
  button.title = result.path
  const label = document.createElement('span')
  const closer = document.createElement('span')
  closer.className = 'close'
  closer.textContent = '×'
  closer.setAttribute('role', 'button')
  closer.setAttribute('aria-label', t.close)
  button.append(label, closer)

  const tab: Tab = { path: result.path, result, pane, button, blocked: [] }
  if (isOpened(result)) {
    label.textContent = result.name
    render(pane, result)
  } else {
    label.textContent = result.path.split(/[\\/]/).pop() || result.path
    button.classList.add('error')
    const err = document.createElement('p')
    err.className = 'doc-error'
    err.textContent = result.error
    pane.append(err)
  }
  button.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).classList.contains('close')) close(tab)
    else activate(tab)
  })
  tabs.push(tab)
  tabsEl.append(button)
  viewEl.append(pane)
  if (focus) activate(tab)
  else {
    pane.hidden = true
    report()
  }
}

// The consent banner: allow, then draw the document again so what was blocked loads.
for (const button of bannerEl.querySelectorAll<HTMLButtonElement>('button[data-scope]')) {
  button.addEventListener('click', async () => {
    if (!active || !isOpened(active.result)) return
    const scope = button.dataset.scope === 'folder' ? 'folder' : 'file'
    await folio.allowNetwork(scope, scope === 'folder' ? active.result.folder : active.result.path)
    active.blocked = []
    showBanner()
    render(active.pane, active.result)
  })
}

folio.onBlocked((value) => {
  const { document: path, hosts } = value as { document: string; hosts: string[] }
  const tab = tabs.find((x) => x.path === path)
  if (!tab) return
  tab.blocked = hosts
  if (tab === active) showBanner()
})
folio.onOpened((value) => add(value as OpenResult))
folio.onCloseTab(() => {
  if (active) close(active)
})

document.querySelector<HTMLButtonElement>('.open')!.addEventListener('click', async () => {
  for (const result of await folio.openDialog()) add(result)
})

// Links: a document of the folder opens in a tab, the web and mail leave folio; anchors stay.
viewEl.addEventListener('click', (event) => {
  const a = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
  if (!a || event.defaultPrevented) return
  const href = a.href
  if (href.startsWith('folio://app/r/')) {
    event.preventDefault()
    void folio.openUrl(href).then((result) => add(result))
  } else if (/^(https?:|mailto:)/.test(href)) {
    event.preventDefault()
    folio.external(href)
  }
})

// Dropping files on the window opens them.
viewEl.addEventListener('dragover', (event) => {
  event.preventDefault()
  viewEl.classList.add('dropping')
})
viewEl.addEventListener('dragleave', () => viewEl.classList.remove('dropping'))
viewEl.addEventListener('drop', async (event) => {
  event.preventDefault()
  viewEl.classList.remove('dropping')
  for (const file of Array.from(event.dataTransfer?.files ?? [])) {
    const path = folio.pathOf(file)
    if (path) add(await folio.open(path))
  }
})

void folio.startup().then(({ documents, active: activePath, locale }) => {
  const lang = locale.toLowerCase().startsWith('ru') ? 'ru' : 'en'
  t = TEXT[lang]
  document.documentElement.lang = lang
  applyText()
  window.DskEmbed?.configure({ theme: 'system', locale: lang })
  for (const result of documents) add(result, false)
  activate(tabs.find((tab) => tab.path === activePath) ?? tabs[tabs.length - 1] ?? null)
})

export {}
