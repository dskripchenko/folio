import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

/**
 * Changes on disk under the roots, gathered for a moment and reported once:
 * which folders changed (to list them again) and which files (to draw an open
 * document again). Recursive watching is native on macOS and Windows and, in
 * Node 22, on Linux too.
 */
export interface Changes {
  root: string
  dirs: string[]
  files: string[]
}

export class Watcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly pending = new Map<string, { dirs: Set<string>; files: Set<string> }>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onChange: (changes: Changes[]) => void,
    private readonly delay = 150,
  ) {}

  /** Watch a root (by its id and folder); watching it again changes nothing. */
  add(id: string, dir: string): void {
    if (this.watchers.has(id)) return
    try {
      const w = watch(dir, { recursive: true }, (_event, name) => {
        if (name === null) return
        const rel = String(name).split(/[\\/]/).filter((p) => p !== '')
        // Tooling and hidden folders are not watched — but a `.gitignore` is: what is shown follows it.
        if (rel.some((p, i) => p === '.git' || p === 'node_modules' || (p.startsWith('.') && !(i === rel.length - 1 && p === '.gitignore')))) return
        const entry = this.pending.get(id) ?? { dirs: new Set<string>(), files: new Set<string>() }
        entry.dirs.add(rel.slice(0, -1).join('/'))
        entry.files.add(join(dir, ...rel))
        this.pending.set(id, entry)
        this.schedule()
      })
      // A folder removed or unplugged: stop quietly.
      w.on('error', () => this.remove(id))
      this.watchers.set(id, w)
    } catch {
      // Not there (a project on an unplugged drive): nothing to watch.
    }
  }

  remove(id: string): void {
    this.watchers.get(id)?.close()
    this.watchers.delete(id)
  }

  close(): void {
    for (const id of [...this.watchers.keys()]) this.remove(id)
    if (this.timer) clearTimeout(this.timer)
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const changes = [...this.pending].map(([root, e]) => ({ root, dirs: [...e.dirs], files: [...e.files] }))
      this.pending.clear()
      if (changes.length > 0) this.onChange(changes)
    }, this.delay)
  }
}
