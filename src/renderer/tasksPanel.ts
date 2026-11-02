/**
 * The tasks of the project in view, beside the page: the open ones by when
 * they are due — overdue, today, later, with no day — or all of them; each
 * checked or unchecked in its note from here, its text a way to the note.
 */
import type { TaskEntry } from './bridge'
import { iconButton } from './icons'

export interface TasksText {
  title: string
  close: string
  open: string
  all: string
  overdue: string
  today: string
  later: string
  noDate: string
  done: string
  none: string
  changed: string
}

export interface TasksDeps {
  load(note: string | null): Promise<TaskEntry[]>
  toggle(task: TaskEntry, done: boolean): Promise<boolean>
  /** A note open with unsaved changes: its tasks are not changed from here. */
  isDirty(path: string): boolean
  open(task: TaskEntry): void
}

/** Today as `YYYY-MM-DD`, in the local day. */
export function today(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Tasks into their groups: done ones last, the rest by when they are due. */
export function groupTasks(tasks: TaskEntry[], day: string, all: boolean): { key: 'overdue' | 'today' | 'later' | 'noDate' | 'done'; tasks: TaskEntry[] }[] {
  const open = tasks.filter((t) => !t.done)
  const byDue = (a: TaskEntry, b: TaskEntry): number => (a.due ?? '').localeCompare(b.due ?? '') || a.rel.localeCompare(b.rel) || a.line - b.line
  const groups = [
    { key: 'overdue' as const, tasks: open.filter((t) => t.due !== null && t.due < day).sort(byDue) },
    { key: 'today' as const, tasks: open.filter((t) => t.due === day).sort(byDue) },
    { key: 'later' as const, tasks: open.filter((t) => t.due !== null && t.due > day).sort(byDue) },
    { key: 'noDate' as const, tasks: open.filter((t) => t.due === null).sort(byDue) },
    ...(all ? [{ key: 'done' as const, tasks: tasks.filter((t) => t.done).sort(byDue) }] : []),
  ]
  return groups.filter((g) => g.tasks.length > 0)
}

export class TasksPanel {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private readonly status: HTMLElement
  private readonly modes: Record<'open' | 'all', HTMLButtonElement>
  private all = false
  private note: string | null = null
  private seq = 0

  constructor(
    private text: TasksText,
    private readonly deps: TasksDeps,
    private readonly onVisibility: (visible: boolean) => void,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'tasks-panel'
    this.el.dataset.testid = 'tasks-panel'
    this.el.hidden = true
    const header = document.createElement('header')
    const title = document.createElement('span')
    title.className = 'tasks-title'
    const switcher = document.createElement('span')
    switcher.className = 'graph-modes'
    const mode = (all: boolean): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'graph-mode'
      b.dataset.testid = all ? 'tasks-all' : 'tasks-open'
      b.addEventListener('click', () => {
        this.all = all
        void this.refresh()
      })
      switcher.append(b)
      return b
    }
    this.modes = { open: mode(false), all: mode(true) }
    const close = iconButton('close', text.close, () => this.setVisible(false))
    header.append(title, switcher, close)
    this.status = document.createElement('div')
    this.status.className = 'tasks-status'
    this.list = document.createElement('div')
    this.list.className = 'tasks-list'
    this.el.append(header, this.status, this.list)
    this.setText(text)
  }

  setText(text: TasksText): void {
    this.text = text
    this.el.querySelector('.tasks-title')!.textContent = text.title
    this.modes.open.textContent = text.open
    this.modes.all.textContent = text.all
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    this.onVisibility(on)
    if (on) void this.refresh()
  }

  show(note: string | null): void {
    if (note === this.note) return
    this.note = note
    void this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.el.hidden) return
    const seq = ++this.seq
    const tasks = await this.deps.load(this.note)
    if (seq !== this.seq) return
    this.modes.open.setAttribute('aria-pressed', String(!this.all))
    this.modes.all.setAttribute('aria-pressed', String(this.all))
    const groups = groupTasks(tasks, today(), this.all)
    if (groups.length === 0) {
      const p = document.createElement('p')
      p.className = 'tasks-none'
      p.textContent = this.text.none
      this.list.replaceChildren(p)
      return
    }
    this.list.replaceChildren(
      ...groups.map((g) => {
        const section = document.createElement('section')
        section.className = `tasks-group tasks-${g.key}`
        section.dataset.testid = `tasks-${g.key}`
        const h = document.createElement('h3')
        h.textContent = `${this.text[g.key]} · ${g.tasks.length}`
        section.append(h, ...g.tasks.map((t) => this.row(t)))
        return section
      }),
    )
  }

  private row(task: TaskEntry): HTMLElement {
    const row = document.createElement('div')
    row.className = 'tasks-row'
    row.dataset.testid = 'task'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = task.done
    box.disabled = this.deps.isDirty(task.path)
    box.addEventListener('change', async () => {
      const ok = await this.deps.toggle(task, box.checked)
      this.status.textContent = ok ? '' : this.text.changed
      void this.refresh()
    })
    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'tasks-text'
    label.textContent = task.text
    label.addEventListener('click', () => this.deps.open(task))
    const where = document.createElement('span')
    where.className = 'tasks-where'
    where.textContent = [task.rel.split('/').pop()!.replace(/\.(md|markdown)$/i, ''), task.due].filter(Boolean).join(' · ')
    row.append(box, label, where)
    return row
  }
}
