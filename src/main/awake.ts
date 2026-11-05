/**
 * Keeping the computer awake (ADR-007, M4), with Electron's power save blocker:
 * IOPMAssertion on macOS, SetThreadExecutionState on Windows, an inhibit over
 * D-Bus on Linux. Until turned off, for a while, until a time, or while a
 * command runs in one of folio's consoles (an agent at work) and a minute
 * after. The display stays on too (no screen saver), unless people let it sleep. A Mac with its lid closed still
 * sleeps (without an external display and power): folio does not get around it.
 */
export type AwakeHow = 'off' | 'on' | 'until' | 'busy'

export interface AwakeState {
  how: AwakeHow
  /** The display kept on too, not only the system. */
  display: boolean
  /** When it ends (`until`); null otherwise. */
  until: number | null
  /** Blocking sleep now (in `busy`: while a command runs, and a minute after). */
  holding: boolean
  /** The system took the request (on Linux it may not). */
  granted: boolean
}

export interface Blocker {
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number
  stop(id: number): void
  isStarted(id: number): boolean
}

export class Awake {
  private how: AwakeHow = 'off'
  private display: boolean
  private until: number | null = null
  private id: number | null = null
  private idType: 'prevent-app-suspension' | 'prevent-display-sleep' | null = null
  private busyCount = 0
  private quietSince: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<(s: AwakeState) => void>()

  constructor(
    private readonly blocker: Blocker,
    private readonly o: { now?: () => number; grace?: number; display?: boolean } = {},
  ) {
    // As Amphetamine: the display stays on unless asked otherwise (a screen saver, a lock, are sleep to people).
    this.display = o.display ?? true
  }

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  private get grace(): number {
    return this.o.grace ?? 60_000
  }

  onChange(fn: (s: AwakeState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get state(): AwakeState {
    return {
      how: this.how,
      display: this.display,
      until: this.until,
      holding: this.id !== null,
      granted: this.id !== null && this.blocker.isStarted(this.id),
    }
  }

  /** Off, on until off, for `minutes`, until a time (ms), or while a command runs. */
  set(how: AwakeHow, o: { display?: boolean; minutes?: number; until?: number } = {}): AwakeState {
    this.how = how
    if (o.display !== undefined) this.display = o.display
    this.until = how === 'until' ? (o.until ?? this.now() + (o.minutes ?? 60) * 60_000) : null
    if (how === 'busy') this.quietSince = this.busyCount > 0 ? null : this.now() - this.grace
    return this.sync()
  }

  setDisplay(on: boolean): AwakeState {
    this.display = on
    return this.sync()
  }

  /** Commands running in the consoles now (a console's command begun or ended). */
  busy(count: number): void {
    const was = this.busyCount
    this.busyCount = Math.max(0, count)
    if (this.busyCount === 0 && was > 0) this.quietSince = this.now()
    if (this.busyCount > 0) this.quietSince = null
    this.sync()
  }

  private wanted(): boolean {
    if (this.how === 'on') return true
    if (this.how === 'until') return this.until !== null && this.now() < this.until
    if (this.how === 'busy') return this.busyCount > 0 || (this.quietSince !== null && this.now() - this.quietSince < this.grace)
    return false
  }

  private sync(): AwakeState {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.how === 'until' && this.until !== null && this.now() >= this.until) {
      this.how = 'off'
      this.until = null
    }
    const type = this.display ? 'prevent-display-sleep' : 'prevent-app-suspension'
    const want = this.wanted()
    if (this.id !== null && (!want || this.idType !== type)) {
      this.blocker.stop(this.id)
      this.id = this.idType = null
    }
    if (want && this.id === null) {
      this.id = this.blocker.start(type)
      this.idType = type
    }
    // Looked at again when a while ends: the time set, a minute after the last command.
    const next =
      this.how === 'until' && this.until !== null ? this.until - this.now() : this.how === 'busy' && this.busyCount === 0 && this.quietSince !== null && want ? this.quietSince + this.grace - this.now() : null
    if (next !== null) {
      this.timer = setTimeout(() => this.sync(), Math.max(0, next) + 10)
      this.timer.unref?.()
    }
    const s = this.state
    for (const fn of this.listeners) {
      try {
        fn(s)
      } catch {
        // A listener's fault (a window gone) never stops keeping awake or letting go.
      }
    }
    return s
  }

  /** folio leaves: the system may sleep again. */
  release(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.id !== null) this.blocker.stop(this.id)
    this.id = this.idType = null
  }
}
