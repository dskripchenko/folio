/**
 * folio's memory limits (ADR-007, M3). A hard heap limit crashes a process at
 * the limit and loses what is not saved, so the limit people set is a soft
 * one: over it, folio lets go of what it can (caches, the heaviest language
 * server), and if that does not help within a minute, says so and offers what
 * to do. A language server has a limit of its own: over it, it is started again.
 * What runs in folio's consoles is not folio's: it counts to neither.
 */
import type { ProcSample, Sample } from './resources'

export const GB = 1024 ** 3

export interface LimitSettings {
  /** folio's whole memory, gigabytes; 0 — no limit. */
  softGb: number
  /** A language server's, gigabytes; 0 — no limit. */
  lspGb: number
  /** A hard limit of each process's JavaScript heap, gigabytes; 0 — V8's own. Taken at the next start. */
  heapGb: number
}

export const LIMIT_DEFAULTS: LimitSettings = { softGb: 4, lspGb: 2, heapGb: 0 }

/** Settings as stored, each within its range (an odd value: the default). */
export function limitSettings(value: unknown): LimitSettings {
  const v = (value ?? {}) as Partial<Record<keyof LimitSettings, unknown>>
  const pick = (key: keyof LimitSettings, max: number) => {
    const n = v[key]
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n * 10) / 10) : LIMIT_DEFAULTS[key]
  }
  return { softGb: pick('softGb', 256), lspGb: pick('lspGb', 64), heapGb: pick('heapGb', 64) }
}

export type LimitAction =
  /** Over the soft limit: caches let go, the heaviest server started again. */
  | { kind: 'relieve'; memory: number; heaviest: ProcSample | null }
  /** Still over a minute later: people are told, with the heaviest. */
  | { kind: 'warn'; memory: number; heaviest: ProcSample | null }
  /** Back under: what was said is taken back. */
  | { kind: 'clear'; memory: number }
  /** A language server over its own limit. */
  | { kind: 'restart-lsp'; proc: ProcSample }

export class Limits {
  private overSince: number | null = null
  private warnedAt: number | null = null
  private readonly restarted = new Map<string, number>()

  constructor(
    private settings: LimitSettings,
    private readonly o = { grace: 60_000, rewarn: 30 * 60_000, lspPause: 5 * 60_000, under: 0.9 },
  ) {}

  set(settings: LimitSettings): void {
    this.settings = settings
  }

  get current(): LimitSettings {
    return this.settings
  }

  /** Over the soft limit now. */
  get over(): boolean {
    return this.overSince !== null
  }

  check(s: Sample): LimitAction[] {
    const out: LimitAction[] = []
    const { softGb, lspGb } = this.settings
    if (lspGb > 0) {
      for (const p of s.procs) {
        if (p.kind !== 'lsp' || p.memory <= lspGb * GB) continue
        const key = p.ref ?? String(p.pid)
        const last = this.restarted.get(key)
        if (last !== undefined && s.at - last < this.o.lspPause) continue
        this.restarted.set(key, s.at)
        out.push({ kind: 'restart-lsp', proc: p })
      }
    }
    const memory = s.total.memory
    const heaviest = s.procs.filter((p) => !p.outside).reduce<ProcSample | null>((a, p) => (!a || p.memory > a.memory ? p : a), null)
    if (softGb <= 0) {
      if (this.overSince !== null) out.push({ kind: 'clear', memory })
      this.overSince = this.warnedAt = null
      return out
    }
    const limit = softGb * GB
    if (this.overSince === null) {
      if (memory > limit) {
        this.overSince = s.at
        out.push({ kind: 'relieve', memory, heaviest })
      }
      return out
    }
    // Under again, with room to spare: over.
    if (memory < limit * this.o.under) {
      this.overSince = this.warnedAt = null
      out.push({ kind: 'clear', memory })
      return out
    }
    if (memory > limit && s.at - this.overSince >= this.o.grace && (this.warnedAt === null || s.at - this.warnedAt >= this.o.rewarn)) {
      this.warnedAt = s.at
      out.push({ kind: 'warn', memory, heaviest })
    }
    return out
  }
}

/** `--max-old-space-size` in megabytes for a heap limit in gigabytes; null — none. */
export function heapFlag(heapGb: number): string | null {
  return heapGb > 0 ? `--max-old-space-size=${Math.round(heapGb * 1024)}` : null
}

/** When folio speaks up (ADR-008): little room on the disk, a long command done, a console grown big. */
export interface AlertSettings {
  /** Free space on the disk under folio-data, gigabytes; 0 — never. */
  diskGb: number
  /** A console's command at least this long (seconds) is told of when it ends; 0 — never. */
  commandSec: number
  /** A console's programs past this (gigabytes) are told of; 0 — never. */
  consoleGb: number
}

export const ALERT_DEFAULTS: AlertSettings = { diskGb: 5, commandSec: 60, consoleGb: 8 }

export function alertSettings(value: unknown): AlertSettings {
  const v = (value ?? {}) as Partial<Record<keyof AlertSettings, unknown>>
  const pick = (key: keyof AlertSettings, max: number) => {
    const n = v[key]
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n * 10) / 10) : ALERT_DEFAULTS[key]
  }
  return { diskGb: pick('diskGb', 1024), commandSec: Math.round(pick('commandSec', 86_400)), consoleGb: pick('consoleGb', 256) }
}
