/**
 * The window: tabs of documents and quick notes. A tab is read (embed's
 * `<dsk-markdown>`, or the element of its format — formats.ts) or edited
 * (`<dsk-markdown-editor>`, or the format's editor); what is typed and not
 * saved goes to a buffer in folio-data as it is typed — closing folio, a crash
 * or a restart loses nothing, and the file changes only on Save (ADR-001).
 */
import { folio as bridge, prefs, type BufferData, type Changes, type EditorMode, type Format, type OpenResult, type Opened, type SaveResult } from './bridge'
import { diffLines } from './diff'
import { canEdit, editorOf, READ_ONLY_BYTES, viewOf, type ViewOptions } from './formats'
import type { CodeState } from './code'
import { domTarget, fieldTarget, selectInField, type FindTarget, type WithFindTarget } from './find'
import { FindBar, type FindText, type Retarget } from './findBar'
import { GoToFile, type GoToFileText } from './goToFile'
import { SearchPanel, type SearchText } from './searchPanel'
import { ConsolePanel, type ConsoleText } from './consolePanel'
import { icon, iconButton, type IconName } from './icons'
import { popMenu, popMenuAt } from './menu'
import { openCloneDialog, type CloneText } from './clone'
import { openPdfDialog, type PdfTarget, type PdfText } from './pdfDialog'
import { describeRefusal, HistoryPanel, type HistoryText } from './history'
import { Sidebar, type SidebarText } from './sidebar'
import { linkSuggester, revealHeading, watchWikiLinks } from './wikilinks'
import { LinksPanel, type LinksText } from './linksPanel'
import { TagsPanel, type TagsText } from './tagsPanel'
import { HoverPreview } from './hoverPreview'
import { GraphPanel, type GraphText } from './graphPanel'
import { StatusBar, type StatusText } from './statusBar'
import { CommandPalette, type Command, type PaletteText } from './commandPalette'

/** The palette's own words and the titles of the commands the menus name only in the main process. */
type CommandsText = PaletteText & Record<'bookmark' | 'unbookmark' | 'file' | 'edit' | 'view' | 'newNote' | 'goToFile' | 'addProject' | 'clone' | 'save' | 'saveAs' | 'closeTab' | 'find' | 'findInFiles' | 'sidebar' | 'notes' | 'daily' | 'dailyPrev' | 'dailyNext' | 'noDaily' | 'insertTemplate' | 'newFromTemplate' | 'chooseTemplate' | 'noTemplates' | 'dailyFolder' | 'templatesFolder', string>
import type { GitRefusal, Version, WorkspaceView } from './bridge'

const TEXT = {
  en: {
    open: 'Open…',
    welcome: 'Open a Markdown file — or drop it here. ⌘N / Ctrl+N starts a quick note.',
    blocked: 'This document wants to load from the web: {hosts}. Nothing was sent.',
    allowFile: 'Allow for this file',
    allowFolder: 'Allow for its folder',
    close: 'Close',
    linksUpdated: 'Links updated in {n} notes.',
    openBeside: 'Open beside',
    backToMain: 'Back to the main view',
    saveBeforePictures: 'Save the note first: its pictures go beside it.',
    pictureNotSaved: 'The picture was not saved.',
    edit: 'Edit',
    read: 'Read',
    untitled: 'Quick note',
    conflict: 'The file changed on disk while you were editing it. Your text is kept; nothing was overwritten.',
    takeDisk: 'Take the file from disk',
    keepMine: 'Keep my version',
    missing: 'The file is gone; your text is kept — save it somewhere.',
    saveFailed: 'Not saved: {error}',
    history: 'History',
    versionOf: 'Version of {date}',
    showVersion: 'This version',
    showDiff: 'Changes',
    showSide: 'Side by side',
    restore: 'Restore this version',
    back: 'Back to the document',
    then: 'Then',
    now: 'Now',
    viewModes: 'View',
    modeNow: '{now} — click: {next}; right click: all modes',
    modeNames: { read: 'Read', visual: 'Edit visually', source: 'Markdown', split: 'Markdown beside the page' } as Record<'read' | 'visual' | 'source' | 'split', string>,
    print: 'Print',
    exportPdf: 'Export as PDF',
    settings: 'Settings',
    themes: { system: 'Theme: as the system', light: 'Theme: light', dark: 'Theme: dark' } as Record<'system' | 'light' | 'dark', string>,
    historyPanel: { title: 'History', noFile: 'Open a file to see its history.', outside: 'This file is outside the projects and Shared: no history here.', noHistory: 'This folder keeps no history yet.', start: 'Keep a history', autoCommit: 'Commit when saved', commitNow: 'Commit now', commitPlaceholder: 'What changed…', commit: 'Commit', noVersions: 'No versions of this file yet.', nothingToCommit: 'Nothing to commit: the changes are in the history already.', close: 'Close', scopeFile: 'This file', scopeAll: 'All commits', graph: 'Commit graph', branches: 'Branches', newBranch: 'New branch', create: 'Create', switched: 'On branch {branch}.', remotePlaceholder: 'Remote: https://… or git@…', connect: 'Connect', sync: 'Sync', syncing: 'Syncing…', synced: { 'up-to-date': 'Up to date.', pushed: 'Sent.', pulled: 'Received.', merged: 'Merged and sent.', conflict: 'Conflicts: resolve them in the text, then finish the merge.' }, username: 'User', token: 'Token or password', remember: 'Remember on this computer', signIn: 'Sign in and sync', mergeConflicts: 'Merging: conflicts in {n} file(s). Edit the text between the <<<<<<< and >>>>>>> lines, save, then finish.', mergeReady: 'Merging: every conflict is resolved.', finishMerge: 'Finish the merge', abortMerge: 'Cancel the merge', mergeDone: 'Merged. Sync to send it.', errors: { dirty: 'Save or commit the changes first: {files}', merging: 'A merge is in progress: finish or cancel it first.', 'no-remote': 'No remote yet.', detached: 'Not on a branch.', auth: 'The remote asks for a login ({detail}).', authSystem: 'git could not log in ({detail}). Set up its credentials as for a terminal: a credential helper or an SSH key.', network: 'Could not reach the remote: {detail}', invalid: 'Not a valid name or address.', markers: 'Conflict markers are still in: {files}', exists: 'Already exists: {detail}', canceled: '' } } as HistoryText,
    pdf: { title: 'Export as PDF', folderTitle: 'Export the folder as one PDF', pageSize: 'Page size', orientation: 'Orientation', portrait: 'Portrait', landscape: 'Landscape', margins: 'Margins', marginNames: ['None', 'Narrow', 'Normal', 'Wide'], header: 'Title at the top of each page', footer: 'Page numbers at the bottom', toc: 'Table of contents', outline: 'Bookmarks from the headings', background: 'Colours and backgrounds', export: 'Export…', exporting: 'Exporting…', cancel: 'Cancel', saved: 'Saved: {file}', failed: 'Not exported: {error}' } as PdfText,
    console: { title: 'Console', newConsole: 'New console', close: 'Close the console', hide: 'Hide the consoles (Ctrl+`)', ended: '[the shell ended, code {code}]', failed: 'The console did not start: {error}', split: 'Split: a console beside', toRight: 'Beside the page', toBottom: 'Under the page', maximize: 'The whole window', restore: 'Back to the panel', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', clear: 'Clear', find: 'Find…', closePane: 'Close this console', running: 'Running: {command}' } as ConsoleText,
    search: { title: 'Search', placeholder: 'Search the files', caseSensitive: 'Match case', wholeWord: 'Whole word', regex: 'Regular expression', close: 'Close', everywhere: 'Everywhere', shared: 'Shared', searching: 'Searching…', summary: '{matches} in {files}', truncated: '(the first ones)', none: 'Nothing found', invalid: 'Invalid expression', matches: ['match', 'matches'], files: ['file', 'files'], toggleReplace: 'Replace', replacePlaceholder: 'Replace with', replaceAll: 'Replace all', confirm: 'Replace {matches} in {files}?', replaced: 'Replaced {matches} in {files}.', committed: 'Committed to the history.', skipped: 'Left out, open with unsaved changes: {n}.', include: 'Replace in this file' } as SearchText,
    links: { title: 'Links', close: 'Close', incoming: 'Linked here', outgoing: 'Links from this note', mentions: 'Named without a link', noNote: 'Open a note to see its links.', none: 'None', missing: 'No such note yet: a click makes it.', link: 'Link', linked: 'Made a link.', changed: 'The note has changed meanwhile: look again.' } as LinksText,
    tags: { title: 'Tags', close: 'Close', filter: 'Filter tags', none: 'No such tag', noTags: 'No tags in this project yet: write #tag in a note, or tags: in its properties.' } as TagsText,
    graph: { title: 'Graph', close: 'Close', local: 'This note', all: 'All', empty: 'No notes here yet.' } as GraphText,
    status: { words: ['word', 'words'], chars: ['character', 'characters'], read: '~{n} min to read', caret: 'Ln {line}, Col {col}' } as StatusText,
    spellcheck: 'Check spelling',
    spellcheckFetch: 'Check spelling (fetches dictionaries)',
    commands: { placeholder: 'Type a command', none: 'No such command', file: 'File', edit: 'Edit', view: 'View', newNote: 'New note', goToFile: 'Go to file…', addProject: 'Add a project…', clone: 'Clone a repository…', save: 'Save', saveAs: 'Save as…', closeTab: 'Close the tab', find: 'Find in the document', findInFiles: 'Find in files', sidebar: 'Show or hide the sidebar', notes: 'Notes', daily: "Today's note", dailyPrev: 'The daily note before', dailyNext: 'The daily note after', noDaily: 'No daily note that way.', insertTemplate: 'Insert a template…', newFromTemplate: 'New note from a template…', chooseTemplate: 'Choose a template', noTemplates: 'No templates yet: put notes in the templates folder ({folder}).', dailyFolder: 'Daily notes folder…', templatesFolder: 'Templates folder…', bookmark: 'Add to bookmarks', unbookmark: 'Remove from bookmarks' } as CommandsText,
    goToFile: { placeholder: 'Go to a file by its name', shared: 'Shared', none: 'No such file', loading: 'Listing the files…' } as GoToFileText,
    find: { placeholder: 'Find', caseSensitive: 'Match case', wholeWord: 'Whole word', regex: 'Regular expression', previous: 'Previous (⇧Enter)', next: 'Next (Enter)', close: 'Close (Esc)', none: 'No matches', invalid: 'Invalid expression', count: '{n} of {total}' } as FindText,
    clone: { title: 'Clone a repository', url: 'Repository address', clone: 'Clone…', cancel: 'Cancel', cloning: 'Cloning…' } as CloneText,
    sidebar: { shared: 'Shared', projects: 'Projects', addProject: 'Add a project', addFolder: 'Add a folder…', cloneRepo: 'Clone a repository…', sharedMenu: 'Shared: folder', projectsMenu: 'Projects: view', resetShared: 'The default folder', openFile: 'Open a file (⌘O)', newNote: 'New quick note (⌘N)', collapse: 'Collapse the sidebar (⌘B)', expand: 'Expand the sidebar (⌘B)', chooseShared: 'Choose the Shared folder', showHidden: 'Show hidden projects', missing: 'not found', empty: 'No documents yet', ungrouped: 'No group', newName: 'Name', newNoteInShared: 'New note', newFolderInShared: 'New folder', bookmarks: 'Bookmarks', unbookmark: 'Remove from bookmarks', errors: { exists: 'There is one with this name already', characters: 'A name cannot have / \\ : * ? " < > |', empty: 'A name is needed', long: 'The name is too long', inside: 'A folder cannot go into itself', failed: 'It did not work' } } as SidebarText,
  },
  ru: {
    open: 'Открыть…',
    welcome: 'Откройте Markdown-файл — или перетащите его сюда. ⌘N / Ctrl+N — быстрая заметка.',
    blocked: 'Документ хочет загрузить из сети: {hosts}. Ничего не отправлено.',
    allowFile: 'Разрешить для файла',
    allowFolder: 'Разрешить для его папки',
    close: 'Закрыть',
    linksUpdated: 'Ссылки обновлены в заметках: {n}.',
    openBeside: 'Открыть рядом',
    backToMain: 'Вернуть в основной вид',
    saveBeforePictures: 'Сначала сохраните заметку: картинки кладутся рядом с ней.',
    pictureNotSaved: 'Картинку сохранить не удалось.',
    edit: 'Править',
    read: 'Читать',
    untitled: 'Быстрая заметка',
    conflict: 'Пока вы правили, файл изменился на диске. Ваш текст сохранён, ничего не перезаписано.',
    takeDisk: 'Взять файл с диска',
    keepMine: 'Оставить мою версию',
    missing: 'Файла больше нет; ваш текст сохранён — сохраните его куда-нибудь.',
    saveFailed: 'Не сохранено: {error}',
    history: 'История',
    versionOf: 'Версия от {date}',
    showVersion: 'Эта версия',
    showDiff: 'Изменения',
    showSide: 'Рядом',
    restore: 'Вернуть эту версию',
    back: 'К документу',
    then: 'Тогда',
    now: 'Сейчас',
    viewModes: 'Вид',
    modeNow: '{now} — щелчок: {next}; правый щелчок: все режимы',
    modeNames: { read: 'Чтение', visual: 'Править визуально', source: 'Markdown', split: 'Markdown рядом со страницей' } as Record<'read' | 'visual' | 'source' | 'split', string>,
    print: 'Печать',
    exportPdf: 'Экспорт в PDF',
    settings: 'Настройки',
    themes: { system: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' } as Record<'system' | 'light' | 'dark', string>,
    historyPanel: { title: 'История', noFile: 'Откройте файл, чтобы увидеть его историю.', outside: 'Файл вне проектов и «Общих»: истории здесь нет.', noHistory: 'Эта папка пока не ведёт историю.', start: 'Вести историю', autoCommit: 'Фиксировать при сохранении', commitNow: 'Зафиксировать сейчас', commitPlaceholder: 'Что изменилось…', commit: 'Зафиксировать', noVersions: 'У этого файла пока нет версий.', nothingToCommit: 'Нечего фиксировать: изменения уже в истории.', close: 'Закрыть', scopeFile: 'Этот файл', scopeAll: 'Все коммиты', graph: 'Граф коммитов', branches: 'Ветки', newBranch: 'Новая ветка', create: 'Создать', switched: 'Ветка {branch}.', remotePlaceholder: 'Удалённый репозиторий: https://… или git@…', connect: 'Подключить', sync: 'Синхронизировать', syncing: 'Синхронизация…', synced: { 'up-to-date': 'Всё совпадает.', pushed: 'Отправлено.', pulled: 'Получено.', merged: 'Слито и отправлено.', conflict: 'Конфликты: разрешите их в тексте и завершите слияние.' }, username: 'Пользователь', token: 'Токен или пароль', remember: 'Запомнить на этом компьютере', signIn: 'Войти и синхронизировать', mergeConflicts: 'Слияние: конфликты в файлах — {n}. Поправьте текст между строками <<<<<<< и >>>>>>>, сохраните и завершите.', mergeReady: 'Слияние: все конфликты разрешены.', finishMerge: 'Завершить слияние', abortMerge: 'Отменить слияние', mergeDone: 'Слито. Синхронизируйте, чтобы отправить.', errors: { dirty: 'Сначала сохраните или зафиксируйте изменения: {files}', merging: 'Идёт слияние: сначала завершите или отмените его.', 'no-remote': 'Удалённого репозитория пока нет.', detached: 'Вы не на ветке.', auth: 'Удалённый репозиторий просит войти ({detail}).', authSystem: 'git не смог войти ({detail}). Настройте его вход как для терминала: помощник учётных данных или SSH-ключ.', network: 'Не удалось связаться с удалённым репозиторием: {detail}', invalid: 'Неверное имя или адрес.', markers: 'Маркеры конфликта ещё есть в: {files}', exists: 'Уже существует: {detail}', canceled: '' } } as HistoryText,
    pdf: { title: 'Экспорт в PDF', folderTitle: 'Экспорт папки одним PDF', pageSize: 'Размер страницы', orientation: 'Ориентация', portrait: 'Книжная', landscape: 'Альбомная', margins: 'Поля', marginNames: ['Без полей', 'Узкие', 'Обычные', 'Широкие'], header: 'Название вверху каждой страницы', footer: 'Номера страниц внизу', toc: 'Оглавление', outline: 'Закладки по заголовкам', background: 'Цвета и фоны', export: 'Экспортировать…', exporting: 'Экспорт…', cancel: 'Отмена', saved: 'Сохранено: {file}', failed: 'Не экспортировано: {error}' } as PdfText,
    console: { title: 'Консоль', newConsole: 'Новая консоль', close: 'Закрыть консоль', hide: 'Скрыть консоли (Ctrl+`)', ended: '[оболочка завершилась, код {code}]', failed: 'Консоль не запустилась: {error}', split: 'Разделить: консоль рядом', toRight: 'Справа от страницы', toBottom: 'Под страницей', maximize: 'На всё окно', restore: 'Вернуть в панель', copy: 'Копировать', paste: 'Вставить', selectAll: 'Выделить всё', clear: 'Очистить', find: 'Найти…', closePane: 'Закрыть эту консоль', running: 'Выполняется: {command}' } as ConsoleText,
    search: { title: 'Поиск', placeholder: 'Искать в файлах', caseSensitive: 'С учётом регистра', wholeWord: 'Слово целиком', regex: 'Регулярное выражение', close: 'Закрыть', everywhere: 'Везде', shared: 'Общие', searching: 'Поиск…', summary: '{matches} в {files}', truncated: '(первые)', none: 'Ничего не найдено', invalid: 'Неверное выражение', matches: ['совпадение', 'совпадения', 'совпадений'], files: ['файле', 'файлах', 'файлах'], toggleReplace: 'Заменить', replacePlaceholder: 'Заменить на', replaceAll: 'Заменить всё', confirm: 'Заменить {matches} в {files}?', replaced: 'Заменено: {matches} в {files}.', committed: 'Зафиксировано в истории.', skipped: 'Пропущены открытые с несохранёнными правками: {n}.', include: 'Заменять в этом файле' } as SearchText,
    links: { title: 'Ссылки', close: 'Закрыть', incoming: 'Ссылаются сюда', outgoing: 'Ссылки из заметки', mentions: 'Упоминания без ссылки', noNote: 'Откройте заметку, чтобы увидеть её ссылки.', none: 'Нет', missing: 'Такой заметки ещё нет: щелчок создаст её.', link: 'Связать', linked: 'Ссылка добавлена.', changed: 'Заметка тем временем изменилась: посмотрите снова.' } as LinksText,
    tags: { title: 'Теги', close: 'Закрыть', filter: 'Найти тег', none: 'Нет такого тега', noTags: 'В этом проекте пока нет тегов: напишите #тег в заметке или tags: в её свойствах.' } as TagsText,
    graph: { title: 'Граф', close: 'Закрыть', local: 'Эта заметка', all: 'Все', empty: 'Заметок здесь пока нет.' } as GraphText,
    status: { words: ['слово', 'слова', 'слов'], chars: ['знак', 'знака', 'знаков'], read: '~{n} мин чтения', caret: 'Стр {line}, кол {col}' } as StatusText,
    spellcheck: 'Проверять орфографию',
    spellcheckFetch: 'Проверять орфографию (скачает словари)',
    commands: { placeholder: 'Введите команду', none: 'Нет такой команды', file: 'Файл', edit: 'Правка', view: 'Вид', newNote: 'Новая заметка', goToFile: 'Перейти к файлу…', addProject: 'Добавить проект…', clone: 'Клонировать репозиторий…', save: 'Сохранить', saveAs: 'Сохранить как…', closeTab: 'Закрыть вкладку', find: 'Найти в документе', findInFiles: 'Найти в файлах', sidebar: 'Показать или скрыть боковую панель', notes: 'Заметки', daily: 'Заметка дня', dailyPrev: 'Предыдущая заметка дня', dailyNext: 'Следующая заметка дня', noDaily: 'В эту сторону заметок дня нет.', insertTemplate: 'Вставить шаблон…', newFromTemplate: 'Новая заметка из шаблона…', chooseTemplate: 'Выберите шаблон', noTemplates: 'Шаблонов пока нет: положите заметки в папку шаблонов ({folder}).', dailyFolder: 'Папка заметок дня…', templatesFolder: 'Папка шаблонов…', bookmark: 'В закладки', unbookmark: 'Убрать из закладок' } as CommandsText,
    goToFile: { placeholder: 'Перейти к файлу по имени', shared: 'Общие', none: 'Такого файла нет', loading: 'Список файлов…' } as GoToFileText,
    find: { placeholder: 'Найти', caseSensitive: 'С учётом регистра', wholeWord: 'Слово целиком', regex: 'Регулярное выражение', previous: 'Предыдущее (⇧Enter)', next: 'Следующее (Enter)', close: 'Закрыть (Esc)', none: 'Не найдено', invalid: 'Неверное выражение', count: '{n} из {total}' } as FindText,
    clone: { title: 'Клонировать репозиторий', url: 'Адрес репозитория', clone: 'Клонировать…', cancel: 'Отмена', cloning: 'Клонирование…' } as CloneText,
    sidebar: { shared: 'Общие', projects: 'Проекты', addProject: 'Добавить проект', addFolder: 'Добавить папку…', cloneRepo: 'Клонировать репозиторий…', sharedMenu: '«Общие»: папка', projectsMenu: 'Проекты: вид', resetShared: 'Папка по умолчанию', openFile: 'Открыть файл (⌘O)', newNote: 'Новая быстрая заметка (⌘N)', collapse: 'Свернуть панель (⌘B)', expand: 'Развернуть панель (⌘B)', chooseShared: 'Выбрать папку «Общих»', showHidden: 'Показать скрытые проекты', missing: 'не найдена', empty: 'Документов пока нет', ungrouped: 'Без группы', newName: 'Имя', newNoteInShared: 'Новая заметка', newFolderInShared: 'Новая папка', bookmarks: 'Закладки', unbookmark: 'Убрать из закладок', errors: { exists: 'Такое имя уже есть', characters: 'В имени нельзя / \\ : * ? " < > |', empty: 'Нужно имя', long: 'Имя слишком длинное', inside: 'Папку нельзя переместить в неё саму', failed: 'Не получилось' } } as SidebarText,
  },
}

const folio = bridge()
/** The links panel: made with the rest of the window, below; activating a tab tells it the note in view. */
let linksPanel: LinksPanel | null = null
/** The tags panel: made with the rest of the window; it lists the tags of the project in view. */
let tagsPanel: TagsPanel | null = null
/** The graph of notes: made with the rest of the window, drawn around the note in view. */
let graphPanel: GraphPanel | null = null
/** The status line under the page. */
let statusBar: StatusBar | null = null
/** Spelling checked as text is written (folio's setting). */
let spellOn = false
/** The modifier key as the system writes it in shortcuts. */
const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'
document.documentElement.dataset.platform = folio.platform

let t = TEXT.en
let sharedDir: string | null = null
const tabsEl = document.querySelector<HTMLElement>('.tabs')!
const viewEl = document.querySelector<HTMLElement>('.view')!
/** The view beside the main one, and the divider between them. */
const besideEl = document.querySelector<HTMLElement>('.view-beside')!
const splitEl = document.querySelector<HTMLElement>('.split')!
const welcomeEl = document.querySelector<HTMLElement>('.welcome')!
const bannerEl = document.querySelector<HTMLElement>('.banner')!
const noticeEl = document.querySelector<HTMLElement>('.notice')!
const railRight = document.querySelector<HTMLElement>('.rail-right')!
let lang: 'en' | 'ru' = 'en'

/** How long typing settles before the buffer is written. */
const BUFFER_DELAY = 700

let tabSeq = 0

interface Tab {
  /** For the elements of its pane (its toolbar's id). */
  id: number
  /** The file, or null for a quick note. */
  path: string | null
  doc: Opened | null
  error: string | null
  view: 'read' | 'edit'
  mode: EditorMode
  /** The text as it is now, and as it is in the file (null: a note never saved). */
  text: string
  saved: string | null
  /** The hash of `saved`, for telling the file changed meanwhile. */
  baseline: string | null
  buffer: string | null
  conflict: boolean
  /** The code view's own state (the levels a log hides), kept over redraws. */
  code: CodeState
  blocked: string[]
  scroll: number
  /** A version from the history shown instead of the document. */
  version: { oid: string; text: string; message: string; time: number; mode: 'version' | 'diff' | 'side' } | null
  timer: ReturnType<typeof setTimeout> | null
  pane: HTMLElement
  button: HTMLButtonElement
  label: HTMLElement
}

const tabs: Tab[] = []
let active: Tab | null = null
/** The tab of the main view, and the one beside it (null: one view). `active` is one of them. */
let mainTab: Tab | null = null
let beside: Tab | null = null

function applyText(): void {
  findBar.setText(t.find)
  goToFile.setText(t.goToFile)
  searchPanel.setText(t.search)
  linksPanel?.setText(t.links)
  tagsPanel?.setText(t.tags)
  graphPanel?.setText(t.graph)
  statusBar?.setText(t.status)
  syncStatus()
  palette.setText(t.commands)
  consolePanel.setText(t.console)
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const value = t[el.dataset.i18n as keyof typeof t]
    if (typeof value === 'string') el.textContent = value
  }
}

function isOpened(r: OpenResult | null): r is Opened {
  return r !== null && !('error' in r)
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isDirty(tab: Tab): boolean {
  return tab.saved === null ? tab.text.trim() !== '' : tab.text !== tab.saved
}

/** A note's name: its first line, without the heading marks. */
function titleOf(tab: Tab): string {
  if (tab.doc) return tab.doc.name
  if (tab.path) return tab.path.split(/[\\/]/).pop() || tab.path
  const first = tab.text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l !== '')
  return first ? first.slice(0, 40) : t.untitled
}

function syncLabel(tab: Tab): void {
  tab.label.textContent = titleOf(tab)
  tab.button.classList.toggle('dirty', isDirty(tab))
  tab.button.classList.toggle('note', tab.path === null)
  tab.button.title = tab.path ?? titleOf(tab)
}

// Drawing -----------------------------------------------------------------------

/**
 * The editor's layout on the pane: Markdown alone or beside the page takes the
 * whole workspace (style.css), the visual editor reads as a page.
 */
function markLayout(tab: Tab): void {
  const format = formatOf(tab)
  let edit = ''
  if (tab.view === 'edit' && !tab.version) {
    if (format === 'markdown') edit = tab.mode === 'visual' ? '' : tab.mode
    else if (format === 'diagram' || format === 'asyncapi') edit = 'split'
    else if (format === 'text') edit = 'source'
  }
  if (edit) tab.pane.dataset.edit = edit
  else delete tab.pane.dataset.edit
  if (tab === active) findBar?.retarget()
}

/** The tab's format: a note is Markdown. */
function formatOf(tab: Tab): Format {
  return tab.doc?.format ?? 'markdown'
}

function viewOptions(tab: Tab, main = false): ViewOptions {
  return { base: tab.doc?.base, name: tab.doc?.name ?? titleOf(tab), main, code: main ? tab.code : undefined }
}

/** A version from the history: as it was, its changes against now, or the two side by side. */
function renderVersion(tab: Tab): void {
  const v = tab.version!
  const bar = document.createElement('div')
  bar.className = 'version-bar'
  bar.dataset.testid = 'version-bar'
  const title = document.createElement('span')
  title.className = 'title'
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v.time * 1000))
  const strong = document.createElement('strong')
  strong.textContent = t.versionOf.replace('{date}', date)
  title.append(strong, ` — ${v.message.split('\n')[0] ?? ''}`)
  bar.append(title)
  const modes: [typeof v.mode, string][] = [['version', t.showVersion], ['diff', t.showDiff], ['side', t.showSide]]
  for (const [mode, label] of modes) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.dataset.mode = mode
    b.setAttribute('aria-pressed', String(v.mode === mode))
    b.addEventListener('click', () => {
      v.mode = mode
      render(tab)
    })
    bar.append(b)
  }
  const restore = document.createElement('button')
  restore.type = 'button'
  restore.className = 'restore'
  restore.textContent = t.restore
  restore.addEventListener('click', () => {
    // Into the editor as an unsaved edit: saving it is the person's call.
    tab.text = v.text
    tab.version = null
    tab.view = 'edit'
    render(tab)
    edited(tab)
    showBanners()
    history.show(tab.path)
  })
  const back = document.createElement('button')
  back.type = 'button'
  back.textContent = t.back
  back.addEventListener('click', () => {
    tab.version = null
    render(tab)
    void history.refresh()
  })
  bar.append(restore, back)
  tab.pane.append(bar)
  if (v.mode === 'version') tab.pane.append(viewOf(formatOf(tab), v.text, viewOptions(tab)))
  else if (v.mode === 'diff') {
    const pre = document.createElement('div')
    pre.className = 'diff'
    pre.dataset.testid = 'diff'
    for (const line of diffLines(v.text, tab.text)) {
      const div = document.createElement('div')
      div.className = line.kind
      div.textContent = line.text === '' ? ' ' : line.text
      pre.append(div)
    }
    tab.pane.append(pre)
  } else {
    const grid = document.createElement('div')
    grid.className = 'side-by-side'
    for (const [label, text] of [[t.then, v.text], [t.now, tab.text]] as const) {
      const col = document.createElement('section')
      const h = document.createElement('h4')
      h.textContent = label
      col.append(h, viewOf(formatOf(tab), text, viewOptions(tab)))
      grid.append(col)
    }
    tab.pane.append(grid)
  }
}

function render(tab: Tab): void {
  tab.pane.replaceChildren()
  markLayout(tab)
  if (tab.version) {
    renderVersion(tab)
    return
  }
  if (tab.error && tab.saved !== null && !tab.buffer) {
    const err = document.createElement('p')
    err.className = 'doc-error'
    err.textContent = tab.error
    tab.pane.append(err)
    return
  }
  const format = formatOf(tab)
  tab.pane.dataset.format = format
  markLayout(tab)
  if (tab.view === 'read' || !canEdit(format)) {
    tab.pane.append(viewOf(format, tab.text, viewOptions(tab, true)))
  } else if (format !== 'markdown') {
    tab.pane.append(
      editorOf(format, tab.text, viewOptions(tab, true), (text) => {
        tab.text = text
        edited(tab)
      }),
    )
  } else {
    const base = tab.doc?.base
    // The editor's toolbar floats over the page, at hand however far down the text goes; the modes are the rail's.
    const bar = document.createElement('div')
    bar.className = 'doc-toolbar'
    bar.id = `doc-toolbar-${tab.id}`
    bar.dataset.testid = 'doc-toolbar'
    tab.pane.append(bar)
    const ed = document.createElement('dsk-markdown-editor') as HTMLElement & { value: string; mode: string; linkSuggest: unknown; saveImage: unknown }
    ed.setAttribute('toolbar-target', `#${bar.id}`)
    ed.setAttribute('mode-switch', 'false')
    if (base) {
      ed.setAttribute('image-base', base)
      ed.setAttribute('link-base', base)
    }
    ed.setAttribute('mode', tab.mode)
    ed.setAttribute('min-height', 'calc(100vh - 140px)')
    // After `[[`: the notes of the document's root.
    ed.linkSuggest = linkSuggester(() => tab.path, folio.wikiNames)
    // Pictures pasted or dropped: into `attachments/` beside the note; a quick note is saved first.
    ed.saveImage = async (file: File) => {
      if (!tab.path) {
        notify(t.saveBeforePictures)
        return null
      }
      const saved = await folio.saveImage(tab.path, file.name, file.type, new Uint8Array(await file.arrayBuffer()))
      if ('error' in saved) {
        notify(t.pictureNotSaved)
        return null
      }
      return saved.path
    }
    const source = document.createElement('script')
    source.type = 'text/plain'
    // textContent, not markup: a `</script>` in the text stays text.
    source.textContent = tab.text
    ed.append(source)
    ed.addEventListener('input', () => {
      tab.text = ed.value
      edited(tab)
    })
    ed.addEventListener('dsk:modechange', (e) => {
      tab.mode = ((e as CustomEvent).detail?.mode ?? tab.mode) as EditorMode
      markLayout(tab)
      edited(tab)
      syncRail()
    })
    tab.pane.append(ed)
  }
}

function showBanners(): void {
  // The network consent.
  if (active && active.blocked.length > 0) {
    bannerEl.querySelector('.banner-text')!.textContent = t.blocked.replace('{hosts}', active.blocked.join(', '))
    bannerEl.hidden = false
  } else bannerEl.hidden = true
  // The file and the edit disagree.
  noticeEl.hidden = !(active && (active.conflict || (active.error && active.buffer)))
  if (active && !noticeEl.hidden) {
    noticeEl.querySelector('.notice-text')!.textContent = active.conflict ? t.conflict : t.missing
    noticeEl.querySelector<HTMLElement>('[data-action="disk"]')!.hidden = !active.conflict
    noticeEl.querySelector<HTMLElement>('[data-action="mine"]')!.hidden = !active.conflict
  }
  syncRail()
}

// The right rail: how the document is shown, then tools; settings at the bottom ------

type ViewMode = 'read' | 'visual' | 'source' | 'split'
const MODES: [ViewMode, IconName][] = [['read', 'read'], ['visual', 'visual'], ['source', 'source'], ['split', 'split']]

/** The modes a document offers: all four for Markdown, read and edit for a drawing with an editor, read alone otherwise. */
function modesOf(tab: Tab | null): Set<ViewMode> {
  if (!tab || (tab.error && !tab.buffer && tab.saved !== null)) return new Set()
  const format = formatOf(tab)
  if (format === 'markdown') return new Set(['read', 'visual', 'source', 'split'])
  // A big file is read, not edited: a text box of 100 MB is no editor.
  return new Set(canEdit(format) && tab.text.length <= READ_ONLY_BYTES ? ['read', 'visual'] : ['read'])
}

function modeOf(tab: Tab): ViewMode {
  if (tab.view === 'read' || tab.version) return 'read'
  return formatOf(tab) === 'markdown' ? (tab.mode as ViewMode) : 'visual'
}

function setMode(tab: Tab | null, mode: ViewMode): void {
  if (!tab || !modesOf(tab).has(mode)) return
  if (mode === 'read') {
    if (tab.view === 'edit' || tab.version) {
      tab.version = null
      toggleEditTo(tab, 'read')
    }
    return syncRail()
  }
  if (formatOf(tab) === 'markdown') {
    tab.mode = mode as EditorMode
    const ed = tab.pane.querySelector<HTMLElement & { mode: string }>('dsk-markdown-editor')
    if (tab.view === 'edit' && ed && !tab.version) {
      ed.mode = mode
      markLayout(tab)
      edited(tab)
    } else toggleEditTo(tab, 'edit')
  } else if (tab.view !== 'edit' || tab.version) toggleEditTo(tab, 'edit')
  syncRail()
}

/** The next mode round the cycle, among those the document offers. */
function nextMode(tab: Tab): ViewMode {
  const offered = MODES.map(([m]) => m).filter((m) => modesOf(tab).has(m))
  return offered[(offered.indexOf(modeOf(tab)) + 1) % offered.length] ?? 'read'
}

function buildRail(): void {
  railRight.replaceChildren()
  const modes = document.createElement('div')
  modes.className = 'rail-group rail-modes'
  // One button goes round the modes; its icon is the mode now, the menu (right click) picks one.
  const cycle = iconButton('read', t.viewModes, () => {
    if (active) setMode(active, nextMode(active))
  }, 'mode')
  cycle.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const tab = active
    if (!tab) return
    const offered = modesOf(tab)
    popMenu(cycle, MODES.filter(([m]) => offered.has(m)).map(([m, name]) => ({ label: t.modeNames[m], icon: name, checked: m === modeOf(tab) ? true : undefined, testid: `mode-pick-${m}`, action: () => setMode(tab, m) })), 'end')
  })
  modes.append(cycle)
  const tools = document.createElement('div')
  tools.className = 'rail-group'
  tools.append(
    iconButton('console', `${t.console.title} (Ctrl+\`)`, () => consolePanel.toggle(null), 'toggle-console'),
    iconButton('search', `${t.search.title} (${mod}⇧F)`, () => (searchPanel.visible ? searchPanel.setVisible(false) : void searchPanel.open()), 'toggle-search'),
    iconButton('links', t.links.title, () => linksPanel?.setVisible(!linksPanel.visible), 'toggle-links'),
    iconButton('tag', t.tags.title, () => tagsPanel?.setVisible(!tagsPanel.visible), 'toggle-tags'),
    iconButton('graph', t.graph.title, () => graphPanel?.setVisible(!graphPanel.visible), 'toggle-graph'),
    iconButton('history', `${t.history} (${mod}⇧H)`, () => toggleHistory(), 'toggle-history'),
    iconButton('print', `${t.print} (${mod}P)`, () => void printActive(), 'rail-print'),
    iconButton('pdf', `${t.exportPdf} (${mod}⇧P)`, () => exportActive(), 'rail-pdf'),
  )
  const bottom = document.createElement('div')
  bottom.className = 'rail-group rail-bottom'
  bottom.append(iconButton('settings', t.settings, (e) => openSettings(e.currentTarget as HTMLElement), 'rail-settings'))
  railRight.append(modes, tools, bottom)
  syncRail()
}

function syncRail(): void {
  const cycle = railRight.querySelector<HTMLButtonElement>('[data-testid="mode"]')
  if (cycle) {
    const offered = active ? modesOf(active) : new Set<ViewMode>()
    const current = active ? modeOf(active) : 'read'
    const name = MODES.find(([m]) => m === current)![1]
    cycle.replaceChildren(icon(name))
    cycle.dataset.mode = current
    cycle.disabled = offered.size < 2
    const label = active && offered.size >= 2 ? t.modeNow.replace('{now}', t.modeNames[current]).replace('{next}', t.modeNames[nextMode(active)]) : t.modeNames[current]
    cycle.title = label
    cycle.setAttribute('aria-label', label)
  }
  const tools = railRight.querySelectorAll<HTMLButtonElement>('[data-testid="toggle-history"], [data-testid="rail-print"], [data-testid="rail-pdf"]')
  for (const b of tools) b.disabled = !active
  // The find bar keeps to the page: left of the panels beside it.
  requestAnimationFrame(() => {
    const beside = [...document.querySelectorAll<HTMLElement>('.content > aside')].reduce((w, a) => w + (a.hidden ? 0 : a.offsetWidth), 0)
    document.querySelector<HTMLElement>('.content')!.style.setProperty('--beside', `${beside}px`)
  })
  const cp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-console"]')
  if (cp) {
    cp.setAttribute('aria-pressed', String(consolePanel.visible))
    cp.classList.toggle('on', consolePanel.visible)
  }
  const gp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-graph"]')
  if (gp) {
    gp.setAttribute('aria-pressed', String(!!graphPanel?.visible))
    gp.classList.toggle('on', !!graphPanel?.visible)
  }
  const tp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-tags"]')
  if (tp) {
    tp.setAttribute('aria-pressed', String(!!tagsPanel?.visible))
    tp.classList.toggle('on', !!tagsPanel?.visible)
  }
  const lp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-links"]')
  if (lp) {
    lp.setAttribute('aria-pressed', String(!!linksPanel?.visible))
    lp.classList.toggle('on', !!linksPanel?.visible)
  }
  const sp = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-search"]')
  if (sp) {
    sp.setAttribute('aria-pressed', String(searchPanel.visible))
    sp.classList.toggle('on', searchPanel.visible)
  }
  const h = railRight.querySelector<HTMLButtonElement>('[data-testid="toggle-history"]')
  if (h) {
    h.disabled = !active?.path
    h.setAttribute('aria-pressed', String(history.visible))
    h.classList.toggle('on', history.visible)
  }
}

// Settings: the theme, for now; more as folio grows.
type Theme = 'system' | 'light' | 'dark'
let theme: Theme = prefs.get<Theme>('theme', 'system')
function applyTheme(next: Theme): void {
  theme = next
  prefs.set('theme', next)
  if (next === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = next
  window.DskEmbed?.configure({ theme: next })
  consoleTheme()
}
function openSettings(anchor: HTMLElement): void {
  popMenu(anchor, [
    ...(['system', 'light', 'dark'] as const).map((value) => ({ label: t.themes[value], checked: theme === value, testid: `theme-${value}`, action: () => applyTheme(value) })),
    { separator: true, label: '', action: () => undefined },
    { label: folio.platform === 'linux' ? t.spellcheckFetch : t.spellcheck, checked: spellOn, testid: 'spellcheck', action: () => void folio.setSpellcheck(!spellOn).then((on) => (spellOn = on)) },
    { separator: true, label: '', action: () => undefined },
    { label: t.commands.dailyFolder, icon: 'calendar', testid: 'daily-folder', action: () => void folio.chooseFolder('daily') },
    { label: t.commands.templatesFolder, icon: 'note', testid: 'templates-folder', action: () => void folio.chooseFolder('templates') },
  ], 'end')
}

// Buffers -------------------------------------------------------------------------

/** The note a tab shows, for the links panel: a Markdown file, its text as in the tab. */
function noteOf(tab: Tab | null): { path: string; text: () => string } | null {
  return tab?.path && formatOf(tab) === 'markdown' && !tab.version ? { path: tab.path, text: () => tab.text } : null
}

let linksTimer: ReturnType<typeof setTimeout> | null = null
/** The links panel drawn again once typing or the disk is quiet. */
function linksSoon(): void {
  if (!linksPanel?.visible && !tagsPanel?.visible && !graphPanel?.visible) return
  if (linksTimer) clearTimeout(linksTimer)
  linksTimer = setTimeout(() => {
    void linksPanel?.refresh()
    void tagsPanel?.refresh()
    void graphPanel?.refresh()
  }, 600)
}

/** The status line for the document in view: its length, and the caret in its source. */
function syncStatus(): void {
  const tab = active
  if (!statusBar) return
  if (!tab || tab.version || (formatOf(tab) !== 'markdown' && formatOf(tab) !== 'text')) return statusBar.show(null)
  const field = [...tab.pane.querySelectorAll('textarea')].find((a) => a.checkVisibility()) ?? null
  statusBar.show({ text: tab.text, field: field && document.activeElement === field ? field : null })
}

/** The text changed: mark it, and write the buffer once typing settles. */
function edited(tab: Tab): void {
  syncLabel(tab)
  if (tab === active) syncStatus()
  if (tab === active) linksSoon()
  if (tab.timer) clearTimeout(tab.timer)
  tab.timer = setTimeout(() => flush(tab), BUFFER_DELAY)
}

function flush(tab: Tab): void {
  if (tab.timer) clearTimeout(tab.timer)
  tab.timer = null
  if (isDirty(tab)) {
    tab.buffer ??= crypto.randomUUID()
    const buffer: BufferData = { id: tab.buffer, path: tab.path, text: tab.text, baseline: tab.baseline, mode: tab.mode, scroll: tab === mainTab || tab === beside ? scrollerOf(tab).scrollTop : tab.scroll }
    folio.writeBuffer(buffer)
  } else if (tab.buffer) {
    folio.dropBuffer(tab.buffer)
    tab.buffer = null
  }
  report()
}

function report(): void {
  const index = active ? tabs.indexOf(active) : -1
  folio.state(
    tabs.map((tab) => ({ path: tab.path, buffer: tab.buffer })),
    index >= 0 ? index : null,
    active?.path ?? null,
  )
}

// Tabs ----------------------------------------------------------------------------

/**
 * The tab in use: shown in the main view — or, when it is the one beside,
 * there; the other view keeps its document. Panels, find and the history
 * follow the tab in use.
 */
function activate(tab: Tab | null): void {
  const wasShown = tab !== null && (tab === mainTab || tab === beside)
  if (tab !== beside && mainTab && mainTab !== tab) mainTab.scroll = viewEl.scrollTop
  if (tab !== beside) mainTab = tab
  active = tab
  for (const other of tabs) {
    other.pane.hidden = other !== mainTab && other !== beside
    other.button.setAttribute('aria-selected', String(other === tab))
    other.button.classList.toggle('shown', other !== tab && (other === mainTab || other === beside))
    other.button.classList.toggle('beside', other === beside)
  }
  welcomeEl.hidden = mainTab !== null
  sidebar.setActive(tab?.path ?? null)
  history.show(tab?.path ?? null)
  linksPanel?.show(noteOf(tab))
  tagsPanel?.show(tab?.path ?? null)
  graphPanel?.show(tab?.path ?? null)
  syncStatus()
  showBanners()
  // A tab coming into its view gets its own scroll back; one already shown keeps where it is.
  if (tab && !wasShown) requestAnimationFrame(() => (scrollerOf(tab).scrollTop = tab.scroll))
  if (tab) recheckLinks.get(tab.pane)?.()
  findBar?.retarget()
  report()
}

/** The view a tab is drawn in. */
function scrollerOf(tab: Tab): HTMLElement {
  return tab === beside ? besideEl : viewEl
}

/** A tab beside the main view; the main view keeps (or takes) another tab. */
function openBeside(tab: Tab): void {
  if (tab === beside) return activate(tab)
  // The main view needs a document of its own: the one there, or another open tab.
  const left = tab === mainTab ? (tabs.filter((x) => x !== tab && x !== beside).at(-1) ?? null) : mainTab
  if (!left) return
  if (beside) backToMain(beside)
  tab.scroll = tab === mainTab ? viewEl.scrollTop : tab.scroll
  beside = tab
  besideEl.append(tab.pane)
  besideEl.hidden = false
  splitEl.hidden = false
  document.querySelector('.content')!.classList.add('two-views')
  if (mainTab !== left) {
    mainTab = null
    activate(left)
  }
  activate(tab)
  requestAnimationFrame(() => (besideEl.scrollTop = tab.scroll))
}

/** The document beside goes back among the main view's tabs. */
function backToMain(tab: Tab): void {
  if (tab !== beside) return
  tab.scroll = besideEl.scrollTop
  beside = null
  viewEl.append(tab.pane)
  besideEl.hidden = true
  splitEl.hidden = true
  document.querySelector('.content')!.classList.remove('two-views')
  tab.pane.hidden = tab !== mainTab
  tab.button.classList.remove('beside', 'shown')
}

/** Close the side view: its document stays open, in a tab of the main view. */
function closeBeside(): void {
  const tab = beside
  if (!tab) return
  backToMain(tab)
  activate(active === tab ? mainTab : active)
}

/** Each pane's check of its `[[links]]`: run again when the tab is shown, as files may have come or gone. */
const recheckLinks = new WeakMap<HTMLElement, () => void>()

function makeTab(init: Partial<Tab> & { path: string | null; text: string; saved: string | null }): Tab {
  const pane = document.createElement('article')
  pane.className = 'doc'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tab'
  button.setAttribute('role', 'tab')
  const label = document.createElement('span')
  label.className = 'label'
  const closer = document.createElement('span')
  closer.className = 'close'
  closer.textContent = '×'
  closer.setAttribute('role', 'button')
  closer.setAttribute('aria-label', t.close)
  button.append(label, closer)
  const tab: Tab = {
    id: ++tabSeq,
    doc: null,
    error: null,
    view: 'read',
    mode: 'visual',
    baseline: null,
    buffer: null,
    conflict: false,
    code: {},
    blocked: [],
    scroll: 0,
    version: null,
    timer: null,
    ...init,
    pane,
    button,
    label,
  }
  pane.dataset.path = tab.path ?? ''
  recheckLinks.set(pane, watchWikiLinks(pane, () => (formatOf(tab) === 'markdown' && !tab.version ? tab.path : null), folio.wikiExists))
  button.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).classList.contains('close')) void close(tab)
    else activate(tab)
  })
  button.addEventListener('auxclick', (event) => {
    if (event.button === 1) void close(tab)
  })
  // Its menu: beside the main view, or back; closed.
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    popMenuAt(event.clientX, event.clientY, [
      ...(tab.path
        ? [bookmarked(tab.path)
            ? { label: t.commands.unbookmark, testid: 'tab-unbookmark', action: () => void folio.bookmark(tab.path!, false) }
            : { label: t.commands.bookmark, testid: 'tab-bookmark', action: () => void folio.bookmark(tab.path!, true) }]
        : []),
      tab === beside
        ? { label: t.backToMain, testid: 'tab-back', action: () => closeBeside() }
        : { label: t.openBeside, testid: 'tab-beside', disabled: tabs.filter((x) => x !== tab).length === 0, action: () => openBeside(tab) },
      { label: t.close, testid: 'tab-close', action: () => void close(tab) },
    ])
  })
  tabs.push(tab)
  tabsEl.append(button)
  viewEl.append(pane)
  syncLabel(tab)
  render(tab)
  pane.hidden = true
  return tab
}

/** A file to show: a tab of its own, or the one it already has. */
async function add(result: OpenResult, focus = true): Promise<void> {
  const existing = tabs.find((tab) => tab.path === result.path)
  if (existing) {
    if (focus) activate(existing)
    return
  }
  const tab = isOpened(result)
    ? makeTab({ path: result.path, doc: result, text: result.text, saved: result.text, baseline: await sha256(result.text) })
    : makeTab({ path: result.path, error: result.error, text: '', saved: '' })
  if (focus) activate(tab)
  else report()
}

function newNote(): void {
  const tab = makeTab({ path: null, text: '', saved: null, view: 'edit' })
  activate(tab)
  requestAnimationFrame(() => (tab.pane.querySelector('dsk-markdown-editor') as (HTMLElement & { focus(): void }) | null)?.focus())
}

function remove(tab: Tab): void {
  const i = tabs.indexOf(tab)
  if (i < 0) return
  if (tab.timer) clearTimeout(tab.timer)
  tabs.splice(i, 1)
  if (tab === beside) backToMain(tab)
  tab.pane.remove()
  tab.button.remove()
  if (tab === mainTab) {
    // The main view takes a neighbour, never the document beside.
    const rest = tabs.filter((x) => x !== beside)
    mainTab = null
    const next = rest[Math.min(i, rest.length - 1)] ?? null
    if (next) activate(next)
    else if (beside) closeBeside()
    else activate(null)
  } else if (active === tab) activate(mainTab)
  else report()
}

async function close(tab: Tab): Promise<void> {
  if (isDirty(tab)) {
    activate(tab)
    const choice = await folio.confirmClose(titleOf(tab))
    if (choice === 'cancel') return
    if (choice === 'save' && !(await save(tab, false))) return
  }
  if (tab.buffer) folio.dropBuffer(tab.buffer)
  tab.buffer = null
  remove(tab)
}

function toggleEdit(tab: Tab | null): void {
  if (!tab) return
  toggleEditTo(tab, tab.view === 'edit' ? 'read' : 'edit')
}

/** Reading or editing: drawn again where the reader was, as near as the other view allows. */
function toggleEditTo(tab: Tab, view: 'read' | 'edit'): void {
  if ((tab.error && !tab.buffer && tab.saved !== null) || !canEdit(formatOf(tab))) return
  const scroller = scrollerOf(tab)
  const ratio = scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0
  tab.version = null
  tab.view = view
  render(tab)
  showBanners()
  requestAnimationFrame(() => (scroller.scrollTop = ratio * scroller.scrollHeight))
}

// Saving ---------------------------------------------------------------------------

function notify(message: string): void {
  const text = noticeEl.querySelector('.notice-text')!
  text.textContent = message
  noticeEl.hidden = false
  for (const b of noticeEl.querySelectorAll<HTMLElement>('button')) b.hidden = true
}

/** Saved: the tab is the file now, the buffer goes. */
function savedAs(tab: Tab, result: Extract<SaveResult, { saved: OpenResult }>): void {
  if (!isOpened(result.saved)) return
  tab.path = result.saved.path
  tab.doc = result.saved
  tab.error = null
  tab.saved = tab.text
  tab.baseline = result.baseline
  tab.conflict = false
  tab.pane.dataset.path = tab.path
  if (tab.buffer) folio.dropBuffer(tab.buffer)
  tab.buffer = null
  syncLabel(tab)
  // The base may be new (a note saved into a folder): its pictures resolve there now.
  if (tab.view === 'read') render(tab)
  sidebar.setActive(active?.path ?? null)
  sidebar.refreshStatus()
  void history.refresh()
  showBanners()
  report()
}

async function save(tab: Tab, as: boolean): Promise<boolean> {
  if (tab.timer) flush(tab)
  const dir = tab.doc?.folder ?? sharedDir
  const result: SaveResult =
    tab.path === null || as || (tab.error !== null && tab.buffer !== null)
      ? await folio.saveAs(tab.text, titleOf(tab), dir)
      : await folio.save(tab.path, tab.text, tab.baseline, false)
  if ('saved' in result) {
    savedAs(tab, result)
    return true
  }
  if ('conflict' in result) {
    tab.conflict = true
    showBanners()
    return false
  }
  if ('error' in result) notify(t.saveFailed.replace('{error}', result.error))
  return false
}

// The file and the edit disagree: take the file, or keep the edit (the next save overwrites).
noticeEl.querySelector('[data-action="disk"]')!.addEventListener('click', async () => {
  const tab = active
  if (!tab?.path) return
  const disk = await folio.disk(tab.path)
  if (!disk) return
  tab.text = tab.saved = disk.text
  tab.baseline = disk.hash
  tab.conflict = false
  render(tab)
  flush(tab)
  syncLabel(tab)
  showBanners()
})
noticeEl.querySelector('[data-action="mine"]')!.addEventListener('click', async () => {
  const tab = active
  if (!tab?.path) return
  const disk = await folio.disk(tab.path)
  tab.saved = disk?.text ?? null
  tab.baseline = disk?.hash ?? null
  tab.conflict = false
  flush(tab)
  syncLabel(tab)
  showBanners()
})

// The sidebar ---------------------------------------------------------------------

const sidebarEl = document.querySelector<HTMLElement>('.sidebar')!
const sidebar = new Sidebar({
  el: sidebarEl,
  rail: document.querySelector<HTMLElement>('.rail-left')!,
  flyout: document.querySelector<HTMLElement>('.flyout')!,
  // Shortcut hints as the system writes them: ⌘ on a Mac, Ctrl+ elsewhere.
  // The shortcuts' key as the system writes it (strings only: the errors are a group of their own).
  text: () => Object.fromEntries(Object.entries(t.sidebar).map(([k, v]) => [k, typeof v === 'string' ? v.replace('⌘', mod) : v])) as unknown as SidebarText,
  open: (root, rel) => void folio.openEntry(root, rel).then((result) => add(result)),
  openPath: (path) => void folio.open(path).then((result) => add(result)),
  clone: () => openClone(),
  openFile: () => void openFiles(),
  newNote: () => newNote(),
})
function openClone(): void {
  openCloneDialog(t.clone, (r) => describeRefusal(t.historyPanel.errors, r as GitRefusal))
}
folio.onClone(() => openClone())

const history = new HistoryPanel({
  el: document.querySelector<HTMLElement>('.history')!,
  text: () => t.historyPanel,
  locale: () => lang,
  current: () => active?.version?.oid ?? null,
  openFile: (path) => void folio.open(path).then((result) => add(result)),
  open: async (path: string, v: Version) => {
    const tab = tabs.find((x) => x.path === path)
    const text = await folio.gitTextAt(path, v.oid)
    if (!tab || text === null) return
    tab.version = { oid: v.oid, text, message: v.message, time: v.time, mode: tab.version?.mode ?? 'version' }
    render(tab)
    scrollerOf(tab).scrollTop = 0
  },
})
function toggleHistory(): void {
  if (!active?.path) return
  history.setVisible(!history.visible)
  prefs.set('historyOpen', history.visible)
  showBanners()
  syncRail()
}
folio.onToggleHistory(() => toggleHistory())
folio.onCommitted((value) => {
  const { path } = value as { path: string }
  if (active?.path === path) void history.refresh()
  sidebar.refreshStatus()
})

// The network consent banner: allow, then draw the document again so what was blocked loads.
for (const button of bannerEl.querySelectorAll<HTMLButtonElement>('button[data-scope]')) {
  button.addEventListener('click', async () => {
    if (!active?.doc || !active.path) return
    const scope = button.dataset.scope === 'folder' ? 'folder' : 'file'
    await folio.allowNetwork(scope, scope === 'folder' ? active.doc.folder : active.path)
    active.blocked = []
    showBanners()
    render(active)
  })
}

folio.onBlocked((value) => {
  const { document: path, hosts } = value as { document: string; hosts: string[] }
  const tab = tabs.find((x) => x.path === path)
  if (!tab) return
  tab.blocked = hosts
  if (tab === active) showBanners()
})
folio.onOpened((value) => void add(value as OpenResult))
folio.onCloseTab(() => {
  if (active) void close(active)
})
folio.onAddProject(() => void sidebar.addProject())
folio.onNewNote(() => newNote())
folio.onSave(() => {
  if (active) void save(active, false)
})
folio.onSaveAs(() => {
  if (active) void save(active, true)
})
folio.onToggleEdit(() => toggleEdit(active))

// A file or folder renamed or moved in the tree: its open documents follow it.
folio.onFsMoved(async (value) => {
  const { from, to } = value as { from: string; to: string }
  for (const tab of tabs) {
    if (!tab.path || (tab.path !== from && !tab.path.startsWith(from + (folio.platform === 'win32' ? '\\' : '/')))) continue
    tab.path = to + tab.path.slice(from.length)
    const reopened = await folio.open(tab.path)
    if (isOpened(reopened)) tab.doc = reopened
    syncLabel(tab)
  }
  if (active) sidebar.setActive(active.path)
  report()
  // Links to it, in the notes of its root, follow; notes with unsaved changes are left alone.
  const skip = tabs.filter((tab) => tab.path && isDirty(tab)).map((tab) => tab.path!)
  const changed = await folio.wikiMoved(from, to, skip)
  if (changed > 0) notify(t.linksUpdated.replace('{n}', String(changed)))
})
// Put in the trash: its clean tabs close; one with unsaved changes stays, as a note to save elsewhere.
folio.onFsRemoved((value) => {
  const { path } = value as { path: string }
  const sep = folio.platform === 'win32' ? '\\' : '/'
  for (const tab of [...tabs]) {
    if (!tab.path || (tab.path !== path && !tab.path.startsWith(path + sep))) continue
    if (!isDirty(tab)) void close(tab)
  }
})

// A file changed on disk: a clean tab takes it, an edited one is told (nothing is overwritten).
folio.onFsChanged(async (value) => {
  linksSoon()
  const files = new Set((value as Changes[]).flatMap((c) => c.files))
  for (const tab of tabs) {
    if (!tab.path || !files.has(tab.path)) continue
    const disk = await folio.disk(tab.path)
    if (!disk || disk.text === tab.saved) continue
    if (isDirty(tab)) {
      if (disk.hash !== tab.baseline && disk.text !== tab.text) {
        tab.conflict = true
        if (tab === active) showBanners()
      }
      continue
    }
    const scroller = scrollerOf(tab)
    const shown = tab === mainTab || tab === beside
    const top = scroller.scrollTop
    // A log read at its end follows it: what is written appears in view.
    const follow = shown && formatOf(tab) === 'text' && top + scroller.clientHeight >= scroller.scrollHeight - 4
    tab.text = tab.saved = disk.text
    tab.baseline = disk.hash
    const reopened = await folio.open(tab.path)
    if (isOpened(reopened)) tab.doc = reopened
    if (tab.view === 'read' || formatOf(tab) !== 'markdown') render(tab)
    else (tab.pane.querySelector('dsk-markdown-editor') as (HTMLElement & { value: string }) | null)?.setAttribute('value', disk.text)
    if (shown) requestAnimationFrame(() => (scroller.scrollTop = follow ? scroller.scrollHeight : top))
  }
})

async function followWikiLink(from: string, target: string): Promise<void> {
  const result = await folio.wikiOpen(from, target)
  await add(result)
  const tab = tabs.find((t) => t.path === result.path)
  // After the frame that gives the tab back its own scroll.
  if (tab && result.heading) requestAnimationFrame(() => revealHeading(tab.pane, result.heading!, scrollerOf(tab)))
}

async function openFiles(): Promise<void> {
  for (const result of await folio.openDialog()) await add(result)
}

// Links: a document of the folder opens in a tab, the web and mail leave folio; anchors stay.
function onLinkClick(event: MouseEvent): void {
  const a = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
  // A #tag: the tags panel opens on it (in the editor, with ⌘ / Ctrl).
  const chip = (event.target as HTMLElement).closest<HTMLElement>('.uid-markdown__tag[data-tag]')
  if (chip && (!chip.closest('[contenteditable="true"]') || event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    tagsPanel?.reveal(chip.dataset.tag!)
    return
  }
  if (!a || event.defaultPrevented) return
  // `[[A note]]`: found by its name in the note's root (made when it is not there); in the editor, with ⌘ / Ctrl.
  const from = tabs.find((tab) => tab.pane.contains(a))?.path
  const editing = !!a.closest('[contenteditable="true"]')
  if (a.dataset.wikilink !== undefined && from && (!editing || event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void followWikiLink(from, a.dataset.wikilink)
    return
  }
  if (editing) return
  const href = a.href
  if (href.startsWith('folio://app/r/')) {
    event.preventDefault()
    void folio.openUrl(href).then((result) => add(result))
  } else if (/^(https?:|mailto:)/.test(href)) {
    event.preventDefault()
    folio.external(href)
  }
}
viewEl.addEventListener('click', onLinkClick)
besideEl.addEventListener('click', onLinkClick)

// A note's preview while the pointer rests on a link to it.
const preview = new HoverPreview({
  peek: (from, link) => folio.peek(from, link),
  draw: (note) => viewOf('markdown', note.text, { base: note.base, name: note.name }),
  reveal: (container, heading, scroller) => revealHeading(container, heading, scroller),
  open: (note) =>
    void folio.open(note.path).then(async (result) => {
      await add(result)
      const tab = tabs.find((t) => t.path === note.path)
      if (tab && note.heading) requestAnimationFrame(() => revealHeading(tab.pane, note.heading!, scrollerOf(tab)))
    }),
  fromOf: (a) => tabs.find((tab) => tab.pane.contains(a))?.path ?? null,
})
document.body.append(preview.el)
preview.attach(viewEl)
preview.attach(besideEl)
// The view scrolled: a preview shown no longer sits by its link.
viewEl.addEventListener('scroll', () => preview.hideShown(), { passive: true })
besideEl.addEventListener('scroll', () => preview.hideShown(), { passive: true })

// A click or focus in a view puts its document in use.
for (const [el, which] of [[viewEl, () => mainTab], [besideEl, () => beside]] as const) {
  const take = (): void => {
    const tab = which()
    if (tab && active !== tab) activate(tab)
  }
  el.addEventListener('pointerdown', take, true)
  el.addEventListener('focusin', take)
}

// The divider between the views: dragged, the main view's share kept for next time.
splitEl.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  splitEl.setPointerCapture(event.pointerId)
  splitEl.classList.add('dragging')
  const move = (e: PointerEvent): void => {
    const r = viewEl.getBoundingClientRect()
    const share = Math.min(0.8, Math.max(0.2, (e.clientX - r.left) / (r.width + besideEl.getBoundingClientRect().width)))
    shareViews(share)
    prefs.set('mainShare', share)
  }
  const up = (): void => {
    splitEl.classList.remove('dragging')
    splitEl.removeEventListener('pointermove', move)
    splitEl.removeEventListener('pointerup', up)
  }
  splitEl.addEventListener('pointermove', move)
  splitEl.addEventListener('pointerup', up)
})
/** The main view's share of the two, the rest beside. */
function shareViews(share: number): void {
  const box = document.querySelector<HTMLElement>('.content')!
  box.style.setProperty('--main-grow', String(share))
  box.style.setProperty('--side-grow', String(1 - share))
}
shareViews(prefs.get<number>('mainShare', 0.5))

// Dropping files on the window opens them.
viewEl.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  viewEl.classList.add('dropping')
})
viewEl.addEventListener('dragleave', () => viewEl.classList.remove('dropping'))
// Seen first: a picture dropped into the editor is taken there and goes no further.
viewEl.addEventListener('drop', () => viewEl.classList.remove('dropping'), true)
viewEl.addEventListener('drop', async (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  viewEl.classList.remove('dropping')
  for (const file of Array.from(event.dataTransfer.files)) {
    const path = folio.pathOf(file)
    if (path) await add(await folio.open(path))
  }
})

// Finding --------------------------------------------------------------------------

/** One field target per text field: it frames its match and follows the field's scroll. */
const fieldTargets = new WeakMap<HTMLTextAreaElement, FindTarget>()

/** What the bar searches: a view's own target, the field being edited, or the page as drawn. */
function findTarget(): Retarget {
  const inConsole = consolePanel.findTarget()
  if (inConsole) return { target: inConsole, own: true, onClose: () => consolePanel.focusActive() }
  const tab = active
  if (!tab) return { target: null }
  const code = tab.pane.querySelector<WithFindTarget>('.code-view')
  if (code?.folioFind) return { target: code.folioFind, own: true }
  const area = [...tab.pane.querySelectorAll('textarea')].find((a) => a.checkVisibility())
  if (area) {
    let target = fieldTargets.get(area)
    if (!target) fieldTargets.set(area, (target = fieldTarget(area)))
    return { target, onClose: (pattern, index) => selectInField(area, pattern, index) }
  }
  return { target: domTarget(tab.pane, '.doc-toolbar') }
}

const findBar = new FindBar(t.find, findTarget, viewEl)
document.querySelector('.content')!.append(findBar.el)
const goToFile = new GoToFile(t.goToFile, () => folio.allFiles(), (f) => void folio.openEntry(f.root, f.path).then((result) => add(result)))
document.body.append(goToFile.el)
folio.onGoToFile(() => void goToFile.open())

// Daily notes and templates ----------------------------------------------------------------

/** Whether a file is among the bookmarks (as the sidebar last showed them). */
let bookmarkPaths = new Set<string>()
folio.onWorkspace((value) => (bookmarkPaths = new Set((value as WorkspaceView).bookmarks.map((b) => b.path))))
void folio.workspace().then((ws) => (bookmarkPaths = new Set(ws.bookmarks.map((b) => b.path))))
const bookmarked = (path: string): boolean => bookmarkPaths.has(path)

const isDaily = (): boolean => !!active?.path && /(^|[\\/])\d{4}-\d{2}-\d{2}\.md$/.test(active.path)

/** Today's daily note, or the one before / after the open one's day. */
async function openDaily(step: 0 | -1 | 1): Promise<void> {
  const result = await folio.dailyOpen(isDaily() ? active!.path : null, step)
  if (!isOpened(result) && result.error === 'none') return notify(t.commands.noDaily)
  await add(result)
}

/** A template chosen in the palette; none there — the folder named. */
async function chooseTemplate(use: (path: string) => void): Promise<void> {
  const list = await folio.templates()
  if (list.length === 0) return notify(t.commands.noTemplates.replace('{folder}', (await folio.folders()).templates))
  palette.pick(list.map((tpl) => ({ id: `template:${tpl.path}`, group: t.commands.notes, title: tpl.name, icon: 'note', run: () => use(tpl.path) })), t.commands.chooseTemplate)
}

/** A template at the caret of the note in view, its title the note's name; read mode switches to editing. */
async function insertTemplate(path: string): Promise<void> {
  const tab = active
  if (!tab) return
  const title = (tab.path ?? '').split(/[\\/]/).pop()?.replace(/\.(md|markdown)$/i, '') ?? ''
  const text = await folio.fillTemplate(path, title)
  if (text === null) return
  if (tab.view !== 'edit') toggleEditTo(tab, 'edit')
  const ed = tab.pane.querySelector<HTMLElement & { insert(text: string): unknown }>('dsk-markdown-editor')
  await ed?.insert(text)
}

/** A quick note from a template: not a file until it is saved. */
async function noteFromTemplate(path: string): Promise<void> {
  const text = await folio.fillTemplate(path, '')
  if (text === null) return
  const tab = makeTab({ path: null, text, saved: null, view: 'edit' })
  activate(tab)
  edited(tab)
}

/** Every action by its name: what the menus and the rails do, offered when it can run. */
function commands(): Command[] {
  const c = t.commands
  const has = (): boolean => active !== null
  const file = c.file
  const view = c.view
  const list: Command[] = [
    { id: 'new-note', group: file, title: c.newNote, keys: `${mod}N`, icon: 'note', run: () => newNote() },
    { id: 'open', group: file, title: t.open, keys: `${mod}O`, icon: 'open', run: () => void folio.openDialog().then(async (docs) => { for (const d of docs) await add(d) }) },
    { id: 'go-to-file', group: file, title: c.goToFile, keys: `${mod}T`, icon: 'file', run: () => void goToFile.open() },
    { id: 'add-project', group: file, title: c.addProject, icon: 'folderPlus', run: () => void sidebar.addProject() },
    { id: 'clone', group: file, title: c.clone, icon: 'clone', run: () => openClone() },
    { id: 'save', group: file, title: c.save, keys: `${mod}S`, icon: 'save', when: has, run: () => active && void save(active, false) },
    { id: 'save-as', group: file, title: c.saveAs, keys: `${mod}⇧S`, icon: 'save', when: has, run: () => active && void save(active, true) },
    { id: 'print', group: file, title: t.print, keys: `${mod}P`, icon: 'print', when: has, run: () => void printActive() },
    { id: 'export-pdf', group: file, title: t.exportPdf, keys: `${mod}⇧P`, icon: 'pdf', when: has, run: () => exportActive() },
    { id: 'close-tab', group: file, title: c.closeTab, keys: `${mod}W`, icon: 'close', when: has, run: () => active && void close(active) },
    { id: 'daily', group: c.notes, title: c.daily, keys: `${mod}⇧D`, icon: 'calendar', run: () => void openDaily(0) },
    { id: 'daily-prev', group: c.notes, title: c.dailyPrev, icon: 'calendar', when: isDaily, run: () => void openDaily(-1) },
    { id: 'daily-next', group: c.notes, title: c.dailyNext, icon: 'calendar', when: isDaily, run: () => void openDaily(1) },
    { id: 'bookmark', group: c.notes, title: c.bookmark, icon: 'star', when: () => !!active?.path && !bookmarked(active.path), run: () => void folio.bookmark(active!.path!, true) },
    { id: 'unbookmark', group: c.notes, title: c.unbookmark, icon: 'star', when: () => !!active?.path && bookmarked(active.path), run: () => void folio.bookmark(active!.path!, false) },
    { id: 'template-insert', group: c.notes, title: c.insertTemplate, icon: 'note', when: () => !!active && formatOf(active) === 'markdown' && !active.version, run: () => void chooseTemplate((path) => void insertTemplate(path)) },
    { id: 'template-new', group: c.notes, title: c.newFromTemplate, icon: 'note', run: () => void chooseTemplate((path) => void noteFromTemplate(path)) },
    { id: 'find', group: c.edit, title: c.find, keys: `${mod}F`, icon: 'search', when: has, run: () => findBar.open() },
    { id: 'find-in-files', group: c.edit, title: c.findInFiles, keys: `${mod}⇧F`, icon: 'search', run: () => void searchPanel.open() },
    ...MODES.map(([m, name]): Command => ({ id: `mode-${m}`, group: view, title: t.modeNames[m], icon: name, when: () => modesOf(active).has(m) && modeOf(active!) !== m, run: () => setMode(active, m) })),
    { id: 'beside', group: view, title: t.openBeside, keys: `${mod}\\`, icon: 'panelRight', when: () => !!active && active !== beside && tabs.length > 1, run: () => active && openBeside(active) },
    { id: 'back-to-main', group: view, title: t.backToMain, keys: `${mod}\\`, icon: 'panelRight', when: () => beside !== null, run: () => closeBeside() },
    { id: 'sidebar', group: view, title: c.sidebar, keys: `${mod}B`, icon: 'collapse', run: () => sidebar.toggleCollapsed() },
    { id: 'console', group: view, title: t.console.title, keys: 'Ctrl+`', icon: 'console', run: () => consolePanel.toggle(null) },
    { id: 'history', group: view, title: t.history, keys: `${mod}⇧H`, icon: 'history', when: () => !!active?.path, run: () => toggleHistory() },
    { id: 'links', group: view, title: t.links.title, icon: 'links', run: () => linksPanel?.setVisible(!linksPanel.visible) },
    { id: 'tags', group: view, title: t.tags.title, icon: 'tag', run: () => tagsPanel?.setVisible(!tagsPanel.visible) },
    { id: 'graph', group: view, title: t.graph.title, icon: 'graph', run: () => graphPanel?.setVisible(!graphPanel.visible) },
    ...(['system', 'light', 'dark'] as const).map((value): Command => ({ id: `theme-${value}`, group: view, title: t.themes[value], icon: 'settings', when: () => theme !== value, run: () => applyTheme(value) })),
  ]
  return list
}
const palette = new CommandPalette(t.commands, commands)
document.body.append(palette.el)
folio.onPalette(() => palette.open())

const searchPanel = new SearchPanel(
  t.search,
  { scopes: () => folio.searchScopes(), run: (id, q, o, scope) => folio.search(id, q, { ...o }, scope), cancel: () => folio.cancelSearch(), onHits: (cb) => void folio.onSearchHits(cb), replace: (q, o, r, files) => folio.replace(q, { ...o }, r, files), isDirty: (file) => tabs.some((tab) => tab.path === file && isDirty(tab)) },
  // The file opened, the find bar landing on the match: the same query, the match's place among the file's.
  (file, index, query, options) =>
    void folio.openEntry(file.root, file.path).then(async (result) => {
      await add(result)
      // After the tab's own scroll comes back (the next frame): then to the match.
      requestAnimationFrame(() => requestAnimationFrame(() => findBar.openWith(query, options, index)))
    }),
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(searchPanel.el, document.querySelector('.history'))

linksPanel = new LinksPanel(
  t.links,
  { panel: (note, text) => folio.wikiPanel(note, text), linkMention: (file, index, length, link) => folio.linkMention(file, index, length, link), isDirty: (file) => tabs.some((tab) => tab.path === file && isDirty(tab)) },
  {
    openAt: (path, place) =>
      void folio.open(path).then(async (result) => {
        await add(result)
        if (place.display) requestAnimationFrame(() => requestAnimationFrame(() => findBar.openWith(place.display, { caseSensitive: false, wholeWord: false, regex: false }, place.nth)))
      }),
    follow: (from, raw) => void followWikiLink(from, raw),
  },
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(linksPanel.el, document.querySelector('.history'))

tagsPanel = new TagsPanel(
  t.tags,
  (note) => folio.tagIndex(note),
  (path) => void folio.open(path).then((result) => add(result)),
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(tagsPanel.el, document.querySelector('.history'))
tagsPanel.show(null)

graphPanel = new GraphPanel(
  t.graph,
  (note) => folio.graph(note),
  (path) => void folio.open(path).then((result) => add(result)),
  () => syncRail(),
)
document.querySelector('.content')!.insertBefore(graphPanel.el, document.querySelector('.history'))
graphPanel.show(null)

statusBar = new StatusBar(document.querySelector<HTMLElement>('.status')!, t.status)
// The caret moved in a source field: its line and column.
document.addEventListener('selectionchange', () => {
  if (document.activeElement instanceof HTMLTextAreaElement) syncStatus()
})
document.addEventListener('focusin', () => syncStatus())
void folio.spellcheck().then((on) => (spellOn = on))
linksPanel.show(noteOf(active))

const consolePanel = new ConsolePanel(
  t.console,
  {
    open: (cwd, cols, rows) => folio.openConsole(cwd, cols, rows),
    input: (id, data) => folio.consoleInput(id, data),
    resize: (id, cols, rows) => folio.consoleResize(id, cols, rows),
    close: (id) => folio.closeConsole(id),
    onData: (cb) => void folio.onConsoleData(cb),
    onExit: (cb) => void folio.onConsoleExit(cb),
    external: (url) => folio.external(url),
    resolve: (cwd, text) => folio.resolveConsolePath(cwd, text),
    openFile: (path, line) => void openAt(path, line),
    pathOf: (file) => folio.pathOf(file),
    platform: folio.platform,
    find: () => findBar.open(),
  },
  () => syncRail(),
)

/** A file opened (or brought to front) at a line: a code view scrolls to it. */
async function openAt(path: string, line: number | null): Promise<void> {
  await add(await folio.open(path))
  if (!line) return
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const code = active?.pane.querySelector<HTMLElement & { folioGoTo?: (n: number) => void }>('.code-view')
      code?.folioGoTo?.(line)
    }),
  )
}
document.querySelector('.main')!.append(consolePanel.el)
// The consoles follow the window's theme.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const consoleTheme = (): void => consolePanel.setDark(theme === 'dark' || (theme === 'system' && darkQuery.matches))
darkQuery.addEventListener('change', consoleTheme)
folio.onToggleConsole(() => consolePanel.toggle(null))
folio.onConsoleHere((path) => void consolePanel.open(path as string))

folio.onFind((what) => (what === 'next' ? findBar.step(1) : what === 'previous' ? findBar.step(-1) : what === 'files' ? void searchPanel.open() : findBar.open()))

// Shortcuts: the window handles them (the menus only show them), the same on every system.
window.addEventListener(
  'keydown',
  (event) => {
    // Ctrl+` on every system: the consoles.
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote') {
      event.preventDefault()
      event.stopPropagation()
      consolePanel.toggle(null)
      return
    }
    // Ctrl with a letter in a console is the shell's (^W, ^E, ^P…), not folio's: off a Mac the shortcuts stay out.
    // Except Ctrl+F: the find bar over the output (as in VS Code's terminal).
    if (folio.platform !== 'darwin' && (event.target as HTMLElement | null)?.closest?.('.dsk-term') && !(event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f')) return
    // F1, as in code editors: the commands.
    if (event.key === 'F1' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault()
      palette.open()
      return
    }
    const mod = folio.platform === 'darwin' ? event.metaKey : event.ctrlKey
    if (!mod || event.altKey) return
    const key = event.key.toLowerCase()
    const act: Record<string, () => void> = {
      n: () => newNote(),
      o: () => void folio.openDialog().then(async (docs) => {
        for (const d of docs) await add(d)
      }),
      s: () => {
        if (active) void save(active, event.shiftKey)
      },
      w: () => {
        if (active) void close(active)
      },
      e: () => toggleEdit(active),
      p: () => (event.shiftKey ? exportActive() : void printActive()),
      h: () => {
        if (event.shiftKey) toggleHistory()
      },
      b: () => sidebar.toggleCollapsed(),
      f: () => (event.shiftKey ? void searchPanel.open() : findBar.open()),
      t: () => void goToFile.open(),
      k: () => palette.open(),
      d: () => {
        if (event.shiftKey) void openDaily(0)
      },
      // The active document beside the main view, or the side view closed.
      '\\': () => (beside ? closeBeside() : active && openBeside(active)),
      g: () => findBar.step(event.shiftKey ? -1 : 1),
    }
    const fn = act[key]
    if (!fn || (key !== 's' && key !== 'h' && key !== 'p' && key !== 'g' && key !== 'f' && key !== 'd' && event.shiftKey) || ((key === 'h' || key === 'd') && !event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    fn()
  },
  true,
)

// Printing ----------------------------------------------------------------------------

/**
 * The active document on paper: read, not edited; every widget in its print
 * form (embed's `print.prepare`) — the whole diagram, every page, a reference
 * as its static view; folio's own chrome stays off paper (style.css).
 */
async function printActive(): Promise<void> {
  const tab = active
  if (!tab) return
  if (tab.view === 'edit' && canEdit(formatOf(tab))) toggleEdit(tab)
  // Paper is light: the widgets too, for the time of printing.
  window.DskEmbed?.configure({ theme: 'light' })
  // It waits for the widgets still drawing (a document just switched to reading), then makes the forms.
  const restore = (await window.DskEmbed?.print?.prepare(tab.pane)) ?? (() => {})
  document.body.dataset.printing = ''
  tab.pane.dataset.printing = ''
  try {
    window.print()
  } finally {
    delete document.body.dataset.printing
    delete tab.pane.dataset.printing
    restore()
    window.DskEmbed?.configure({ theme })
  }
}
folio.onPrint(() => void printActive())

// Export as PDF: the active document as shown (unsaved edits too), a file or a folder from the tree.
function exportPdf(target: PdfTarget): void {
  openPdfDialog(t.pdf, target, notify)
}
function exportActive(): void {
  if (!active) return
  exportPdf({ kind: 'doc', path: active.path, text: active.text, name: titleOf(active) })
}
folio.onExportPdf(() => exportActive())
folio.onExportFile((value) => exportPdf({ kind: 'doc', path: value as string }))
folio.onExportFolder((value) => exportPdf({ kind: 'folder', dir: value as string }))

// Going away: what is still settling is written now.
window.addEventListener('beforeunload', () => {
  for (const tab of tabs) if (tab.timer) flush(tab)
})

// The sidebar: collapsed to its rail with Cmd/Ctrl+B, its width dragged and remembered.
document.documentElement.style.setProperty('--sidebar-width', `${prefs.get('sidebarWidth', 260)}px`)
folio.onToggleSidebar(() => sidebar.toggleCollapsed())
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

// A failure while starting is shown, not left as an empty window.
function startupFailed(error: unknown): void {
  const p = welcomeEl.querySelector('p')
  if (p) {
    p.textContent = `folio could not start: ${error instanceof Error ? error.message : String(error)}`
    p.dataset.testid = 'startup-error'
  }
}

// Start: what was open comes back — files, unsaved edits, quick notes.
void folio.startup().then(async ({ tabs: restored, active: activeIndex, locale, shared }) => {
  lang = locale.toLowerCase().startsWith('ru') ? 'ru' : 'en'
  t = TEXT[lang]
  sharedDir = shared
  history.setVisible(prefs.get('historyOpen', false))
  document.documentElement.lang = lang
  applyText()
  window.DskEmbed?.configure({ locale: lang })
  applyTheme(theme)
  buildRail()
  void sidebar.load()
  for (const r of restored) {
    const doc = isOpened(r.doc) ? r.doc : null
    const b = r.buffer
    if (b) {
      makeTab({
        path: b.path,
        doc,
        error: r.doc && !isOpened(r.doc) ? r.doc.error : null,
        text: b.text,
        // The file as it is now, or what the edit started from when the file is gone.
        saved: b.path === null ? null : doc ? doc.text : '',
        baseline: r.conflict ? b.baseline : doc ? await sha256(doc.text) : b.baseline,
        buffer: b.id,
        view: 'edit',
        mode: b.mode,
        scroll: b.scroll,
        conflict: r.conflict,
      })
    } else if (r.doc) await add(r.doc, false)
  }
  for (const tab of tabs) syncLabel(tab)
  activate(tabs[activeIndex ?? -1] ?? tabs[tabs.length - 1] ?? null)
}).catch(startupFailed)
