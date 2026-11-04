import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Ignores } from './ignore'
import { SKIP } from './tree'

/** A project of notes (folio's first use) or of code (ADR-002, I1): what is shown and how git works there. */
export type ProjectKind = 'notes' | 'code'

/** Files at a folder's top that say it is code. */
const CODE_MARKERS = [
  'package.json',
  'composer.json',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CMakeLists.txt',
  'Makefile',
  'mix.exs',
  'deno.json',
]

/** Markdown at the top of a repository that is still code: the files every repository has. */
const REPO_DOCS = /^(readme|changelog|contributing|license|licence|security|code_of_conduct|authors|history|notice)(\.[a-z]+)*\.md$/i

/**
 * What a folder is: code when its top has a project file (`package.json`,
 * `go.mod`…) or a solution, or is a repository with no notes beside its usual
 * documents; notes otherwise.
 */
export function detectKind(dir: string): ProjectKind {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return 'notes'
  }
  if (names.some((n) => CODE_MARKERS.includes(n) || /\.(sln|csproj|xcodeproj)$/i.test(n))) return 'code'
  if (existsSync(join(dir, '.git')) && !names.some((n) => /\.md$/i.test(n) && !REPO_DOCS.test(n))) return 'code'
  return 'notes'
}

/** What a folder's walkers see of it: the tree, going to a file, search. */
export interface Visibility {
  /** Shown in the tree (and walked further, for a folder). */
  listed(name: string, path: string, isDir: boolean): boolean
  /** Among the files to go to and to search (a folder: walked for them). */
  indexed(name: string, path: string, isDir: boolean): boolean
}

/** System litter, never shown. */
const LITTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

/** Folders of dependencies and build output: in the tree of a folder without git, not among the files to go to. */
export const NOT_INDEXED = new Set(['vendor', 'dist', 'build', 'target', 'coverage', '__pycache__', 'venv', 'bower_components'])

/**
 * Under git, what git leaves out is left out (`.gitignore`); elsewhere
 * folio's lists of tooling folders. A code project shows its dot files
 * (`.github`, `.editorconfig`, `.env`), a notes project keeps them hidden.
 */
export function visibilityOf(dir: string, kind: ProjectKind, ignores: Ignores): Visibility {
  const git = ignores.of(dir) !== null
  const dots = (name: string) => kind === 'notes' && name.startsWith('.')
  if (git) {
    const listed = (name: string, path: string, isDir: boolean) =>
      name !== '.git' && !LITTER.has(name) && !dots(name) && !SKIP_ALWAYS.has(name) && !ignores.ignored(path, isDir)
    return { listed, indexed: (name, path, isDir) => listed(name, path, isDir) && !(isDir && isWorktree(path)) }
  }
  const listed = (name: string) => !LITTER.has(name) && !dots(name) && !SKIP.has(name) && (kind === 'code' || !name.startsWith('.'))
  return {
    listed,
    indexed: (name, path, isDir) => listed(name) && !(isDir && (NOT_INDEXED.has(name) || name.startsWith('.') || isWorktree(path))),
  }
}

/**
 * A worktree inside the project (an agent's, in `.claude/worktrees`): its
 * `.git` is a file. Another copy of the same files — shown in the tree, left
 * out of going to a file and of search (ADR-006).
 */
export function isWorktree(dir: string): boolean {
  try {
    return statSync(join(dir, '.git')).isFile()
  } catch {
    return false
  }
}

/** folio's own data, never shown even when git does not leave it out. */
const SKIP_ALWAYS = new Set(['.folio-data', 'folio-data'])
