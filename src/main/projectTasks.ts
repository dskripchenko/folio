import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readProjectSettings } from './projectSettings'

/**
 * A project's tasks (ADR-002, I3), found where projects keep them: the
 * scripts of `package.json` (run by the package manager its lockfile names)
 * and `composer.json`, the targets of a `Makefile`, the recipes of a
 * `justfile`, and the tasks of `.folio/settings.json`.
 */
export interface ProjectTask {
  name: string
  command: string
  source: 'npm' | 'composer' | 'make' | 'just' | 'folio'
}

const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The package manager a Node project uses, by its lockfile. */
export function packageRunner(dir: string): string {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm run'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn run'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun run'
  return 'npm run'
}

/** A Makefile's targets people run: not special (`.PHONY`), not patterns, not files' names. */
export function makeTargets(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][\w-]*(?:[ \t]+[A-Za-z0-9][\w-]*)*)[ \t]*:(?![=:])/.exec(line)
    if (!m) continue
    for (const t of m[1]!.split(/[ \t]+/)) if (!out.includes(t)) out.push(t)
  }
  return out
}

/** A justfile's recipes (not the private ones, `_`-named). */
export function justRecipes(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^@?([A-Za-z][\w-]*)(?:\s+[^:=]*)?:(?!=)/.exec(line)
    if (m && !out.includes(m[1]!)) out.push(m[1]!)
  }
  return out
}

export function tasksOf(dir: string): ProjectTask[] {
  const out: ProjectTask[] = []
  const pkg = read(join(dir, 'package.json'))
  if (pkg) {
    try {
      const scripts = (JSON.parse(pkg) as { scripts?: Record<string, unknown> }).scripts ?? {}
      const runner = packageRunner(dir)
      for (const name of Object.keys(scripts)) if (typeof scripts[name] === 'string') out.push({ name, command: `${runner} ${name}`, source: 'npm' })
    } catch {
      // Not JSON: no scripts to offer.
    }
  }
  const composer = read(join(dir, 'composer.json'))
  if (composer) {
    try {
      const scripts = (JSON.parse(composer) as { scripts?: Record<string, unknown> }).scripts ?? {}
      for (const name of Object.keys(scripts)) if (!/^(pre|post)-/.test(name)) out.push({ name, command: `composer run-script ${name}`, source: 'composer' })
    } catch {
      // Not JSON.
    }
  }
  const makefile = read(join(dir, 'Makefile')) ?? read(join(dir, 'makefile')) ?? read(join(dir, 'GNUmakefile'))
  if (makefile) for (const t of makeTargets(makefile)) out.push({ name: t, command: `make ${t}`, source: 'make' })
  const justfile = read(join(dir, 'justfile')) ?? read(join(dir, 'Justfile')) ?? read(join(dir, '.justfile'))
  if (justfile) for (const r of justRecipes(justfile)) out.push({ name: r, command: `just ${r}`, source: 'just' })
  for (const t of readProjectSettings(dir).tasks ?? []) out.push({ name: t.name, command: t.command, source: 'folio' })
  return out
}
