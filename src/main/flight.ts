/**
 * Work asked for again and again — on every change on disk — done at most once
 * at a time per key (ADR-008, S1). Whoever asks while it runs shares the next
 * run, which starts after the current one, so it still sees every change made
 * before it was asked for. Without this, an agent writing files queued work
 * faster than it finished and memory grew without end (folio 1.10.0).
 */
export class Flights<T> {
  private readonly slots = new Map<string, { running: Promise<T> | null; queued: Promise<T> | null }>()

  constructor(readonly kind: string) {}

  run(key: string, work: () => Promise<T>): Promise<T> {
    let slot = this.slots.get(key)
    if (!slot) this.slots.set(key, (slot = { running: null, queued: null }))
    const s = slot
    if (s.queued) return s.queued
    const start = (): Promise<T> => {
      const p = work()
      s.running = p
      const done = () => {
        if (s.running === p) s.running = null
        if (!s.running && !s.queued && this.slots.get(key) === s) this.slots.delete(key)
      }
      p.then(done, done)
      return p
    }
    if (!s.running) return start()
    const after = () => {
      s.queued = null
      return start()
    }
    const queued = s.running.then(after, after)
    s.queued = queued
    return queued
  }

  /** Work running and waiting now. */
  stats(): { running: number; queued: number } {
    let running = 0
    let queued = 0
    for (const s of this.slots.values()) {
      if (s.running) running++
      if (s.queued) queued++
    }
    return { running, queued }
  }
}

/** Every kind made, for the log's minute sample. */
const all: Flights<unknown>[] = []

export function flights<T>(kind: string): Flights<T> {
  const f = new Flights<T>(kind)
  all.push(f as Flights<unknown>)
  return f
}

export function flightStats(): Record<string, { running: number; queued: number }> {
  return Object.fromEntries(all.map((f) => [f.kind, f.stats()]))
}

/**
 * A result kept until something under its key changes on disk, read by one
 * flight at a time (ADR-008: the folder's files for links, tags, the graph,
 * tasks — walked again only after a change there, not on every ask).
 */
export class Kept<T> {
  private readonly cache = new Map<string, T>()
  private generation = 0
  private readonly reads: Flights<T>

  constructor(
    kind: string,
    private readonly read: (key: string) => Promise<T>,
    private readonly max = 64,
  ) {
    this.reads = flights<T>(kind)
  }

  get(key: string): Promise<T> {
    const hit = this.cache.get(key)
    if (hit !== undefined) return Promise.resolve(hit)
    return this.reads.run(key, async () => {
      const gen = this.generation
      const value = await this.read(key)
      // Changed while it was read: not kept, the next ask reads again.
      if (gen === this.generation) {
        this.cache.set(key, value)
        while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!)
      }
      return value
    })
  }

  /** A change under a folder: what is kept for it, inside it or around it, goes. */
  changed(dir: string, sep = '/'): void {
    this.generation++
    for (const key of [...this.cache.keys()]) {
      if (key === dir || key.startsWith(dir + sep) || dir.startsWith(key + sep)) this.cache.delete(key)
    }
  }

  clear(): void {
    this.generation++
    this.cache.clear()
  }
}
