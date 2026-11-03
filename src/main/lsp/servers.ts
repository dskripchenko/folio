import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * The language servers folio knows by name (ADR-003): what each speaks, where
 * a project keeps it, what it is called on the PATH. folio carries none; a
 * project's own (in node_modules, vendor, .venv) runs only once the project
 * is trusted, one on the PATH at once.
 */
export interface ServerKind {
  id: string
  name: string
  /** The languages (ids of @dskripchenko/syntax) it serves. */
  languages: string[]
  /** Where a project keeps it, from its top. */
  local: string[]
  /** Its names on the PATH. */
  global: string[]
  args: string[]
  /** How to get it, said when none is found. */
  install: string
}

export const SERVERS: ServerKind[] = [
  { id: 'typescript', name: 'typescript-language-server', languages: ['typescript', 'javascript'], local: ['node_modules/.bin/typescript-language-server'], global: ['typescript-language-server'], args: ['--stdio'], install: 'npm i -g typescript-language-server typescript' },
  { id: 'intelephense', name: 'intelephense', languages: ['php'], local: ['node_modules/.bin/intelephense'], global: ['intelephense'], args: ['--stdio'], install: 'npm i -g intelephense' },
  { id: 'phpactor', name: 'phpactor', languages: ['php'], local: ['vendor/bin/phpactor'], global: ['phpactor'], args: ['language-server'], install: 'composer require --dev phpactor/phpactor' },
  { id: 'pyright', name: 'pyright', languages: ['python'], local: ['node_modules/.bin/pyright-langserver', '.venv/bin/pyright-langserver'], global: ['pyright-langserver', 'basedpyright-langserver'], args: ['--stdio'], install: 'npm i -g pyright' },
  { id: 'pylsp', name: 'pylsp', languages: ['python'], local: ['.venv/bin/pylsp'], global: ['pylsp'], args: [], install: 'pip install python-lsp-server' },
  { id: 'gopls', name: 'gopls', languages: ['go'], local: [], global: ['gopls'], args: [], install: 'go install golang.org/x/tools/gopls@latest' },
  { id: 'rust-analyzer', name: 'rust-analyzer', languages: ['rust'], local: [], global: ['rust-analyzer'], args: [], install: 'rustup component add rust-analyzer' },
  { id: 'clangd', name: 'clangd', languages: ['c', 'cpp'], local: [], global: ['clangd'], args: [], install: 'clangd from LLVM' },
]

/** A language's id as the protocol names it, by the file's extension. */
export function languageIdOf(path: string, language: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (language === 'typescript') return ext === '.tsx' ? 'typescriptreact' : 'typescript'
  if (language === 'javascript') return ext === '.jsx' ? 'javascriptreact' : 'javascript'
  return language
}

let loginPath: Promise<string> | null = null

/**
 * The PATH of the user's login shell: a program started from the Dock or the
 * Finder gets the system's short one, without Homebrew, nvm or ~/go/bin.
 */
export function userPath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (process.platform === 'win32') return Promise.resolve(env.PATH ?? env.Path ?? '')
  loginPath ??= new Promise((resolve) => {
    const shell = env.SHELL && existsSync(env.SHELL) ? env.SHELL : '/bin/bash'
    execFile(shell, ['-l', '-c', 'printf %s "$PATH"'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      const own = env.PATH ?? ''
      // The login shell's first, then what folio has (nothing lost).
      resolve(error || !stdout.trim() ? own : [...new Set([...stdout.trim().split(delimiter), ...own.split(delimiter)])].join(delimiter))
    })
  })
  return loginPath
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** A program on the PATH, by name; null when it is not there. */
export function onPath(name: string, path: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, name + ext)
      if (isFile(full)) return full
    }
  }
  return null
}

export interface FoundServer {
  kind: ServerKind | null
  /** The command and its arguments. */
  command: string
  args: string[]
  /** The project's own program (or a command of its settings): run only in a trusted project. */
  local: boolean
  name: string
}

/**
 * The server for a language in a project: a command of its settings (false:
 * none wanted), else the first server folio knows that the project has, else
 * one on the PATH. null with the way to get one when there is none.
 */
export async function findServer(
  root: string,
  language: string,
  setting: string[] | false | undefined,
): Promise<FoundServer | { none: true; install: string | null }> {
  if (setting === false) return { none: true, install: null }
  if (Array.isArray(setting) && setting.length > 0) return { kind: null, command: setting[0]!, args: setting.slice(1), local: true, name: setting[0]!.split(/[\\/]/).pop()! }
  const kinds = SERVERS.filter((s) => s.languages.includes(language))
  if (kinds.length === 0) return { none: true, install: null }
  for (const kind of kinds)
    for (const rel of kind.local) {
      const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']
      for (const ext of exts) {
        const full = join(root, ...rel.split('/')) + ext
        if (isFile(full)) return { kind, command: full, args: kind.args, local: true, name: kind.name }
      }
    }
  const path = await userPath()
  for (const kind of kinds)
    for (const name of kind.global) {
      const full = onPath(name, path)
      if (full) return { kind, command: full, args: kind.args, local: false, name: kind.name }
    }
  return { none: true, install: kinds[0]!.install }
}
