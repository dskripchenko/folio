/**
 * The window: tabs of open documents, each a `<dsk-markdown>` of embed with
 * its relative paths on `folio://`, and the network consent banner.
 */
import { folio as bridge, prefs, type Changes, type OpenResult, type Opened } from './bridge'
import { Sidebar, type SidebarText } from './sidebar'

const TEXT = {
  en: {
    open: 'Open…',
    welcome: 'Open a Markdown file — or drop it here.',
    blocked: 'This document wants to load from the web: {hosts}. Nothing was sent.',
    allowFile: 'Allow for this file',
    allowFolder: 'Allow for its folder',
    close: 'Close',
    sidebar: { shared: 'Shared', projects: 'Projects', addProject: 'Add a project folder', chooseShared: 'Choose the Shared folder', showHidden: 'Show hidden projects', noProjects: 'Add a folder as a project with +.', missing: 'not found', empty: 'No documents yet', ungrouped: 'No group' } as SidebarText,
  },
  ru: {
    open: 'Открыть…',
    welcome: 'Откройте Markdown-файл — или перетащите его сюда.',
    blocked: 'Документ хочет загрузить из сети: {hosts}. Ничего не отправлено.',
    allowFile: 'Разрешить для файла',
    allowFolder: 'Разрешить для его папки',
    close: 'Закрыть',
    sidebar: { shared: 'Общие', projects: 'Проекты', addProject: 'Добавить папку проекта', chooseShared: 'Выбрать папку «Общих»', showHidden: 'Показать скрытые проекты', noProjects: 'Добавьте папку проектом кнопкой +.', missing: 'не найдена', empty: 'Документов пока нет', ungrouped: 'Без группы' } as SidebarText,
  },
}

const folio = bridge()
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
    const value = t[el.dataset.i18n as keyof typeof t]
    if (typeof value === 'string') el.textContent = value
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

const sidebarEl = document.querySelector<HTMLElement>('.sidebar')!
const sidebar = new Sidebar({
  el: sidebarEl,
  text: () => t.sidebar,
  open: (root, rel) => void folio.openEntry(root, rel).then((result) => add(result)),
})

function activate(tab: Tab | null): void {
  active = tab
  for (const other of tabs) {
    other.pane.hidden = other !== tab
    other.button.setAttribute('aria-selected', String(other === tab))
  }
  welcomeEl.hidden = tab !== null
  sidebar.setActive(tab && isOpened(tab.result) ? tab.path : null)
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
folio.onAddProject(() => void sidebar.addProject())

// A document changed on disk: read it again, keep the place.
folio.onFsChanged(async (value) => {
  const files = new Set((value as Changes[]).flatMap((c) => c.files))
  for (const tab of tabs) {
    if (!files.has(tab.path)) continue
    const result = await folio.open(tab.path)
    if (!isOpened(result)) continue
    const top = viewEl.scrollTop
    tab.result = result
    render(tab.pane, result)
    if (tab === active) requestAnimationFrame(() => (viewEl.scrollTop = top))
  }
})

// The sidebar: hidden with Cmd/Ctrl+B, its width dragged and remembered.
document.body.classList.toggle('no-sidebar', prefs.get('sidebarHidden', false))
document.documentElement.style.setProperty('--sidebar-width', `${prefs.get('sidebarWidth', 260)}px`)
folio.onToggleSidebar(() => {
  const hidden = !document.body.classList.contains('no-sidebar')
  document.body.classList.toggle('no-sidebar', hidden)
  prefs.set('sidebarHidden', hidden)
})
const resizer = document.querySelector<HTMLElement>('.resizer')!
resizer.addEventListener('pointerdown', (event) => {
  resizer.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent) => {
    const width = Math.min(560, Math.max(180, e.clientX))
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
    prefs.set('sidebarWidth', width)
  }
  resizer.addEventListener('pointermove', move)
  resizer.addEventListener('pointerup', () => resizer.removeEventListener('pointermove', move), { once: true })
})
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
  void sidebar.load()
  for (const result of documents) add(result, false)
  activate(tabs.find((tab) => tab.path === activePath) ?? tabs[tabs.length - 1] ?? null)
})

