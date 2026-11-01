/** The labels of folio's native menus, in the system's language (ru or en). */
const LABELS = {
  en: {
    file: 'File',
    open: 'Open…',
    addProject: 'Add Project Folder…',
    closeTab: 'Close Tab',
    view: 'View',
    toggleSidebar: 'Toggle Sidebar',
    pin: 'Pin to the top',
    unpin: 'Unpin',
    rename: 'Rename…',
    group: 'Group…',
    hide: 'Hide',
    show: 'Show',
    reveal: process.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder',
    remove: 'Remove from folio',
  },
  ru: {
    file: 'Файл',
    open: 'Открыть…',
    addProject: 'Добавить папку проекта…',
    closeTab: 'Закрыть вкладку',
    view: 'Вид',
    toggleSidebar: 'Боковая панель',
    pin: 'Закрепить сверху',
    unpin: 'Открепить',
    rename: 'Переименовать…',
    group: 'Группа…',
    hide: 'Скрыть',
    show: 'Показать',
    reveal: process.platform === 'darwin' ? 'Показать в Finder' : 'Показать в папке',
    remove: 'Убрать из folio',
  },
}

export type Labels = (typeof LABELS)['en']

export function labels(locale: string): Labels {
  return locale.toLowerCase().startsWith('ru') ? LABELS.ru : LABELS.en
}
