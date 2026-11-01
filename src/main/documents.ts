import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { real } from './paths'
import type { Roots } from './roots'
import type { Workspace } from './workspace'

export const MARKDOWN = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt']

/** The largest document folio opens; a bigger one is not a document. */
export const MAX_BYTES = 20 * 1024 * 1024

export interface OpenedDocument {
  path: string
  name: string
  text: string
  /** Where the document's relative paths resolve: `folio://app/r/<root>/<its folder>/`. */
  base: string
  /** Its folder for the network consent and links. */
  folder: string
  owner: 'shared' | 'project' | 'file'
  project: string | null
  /** The root it reads from (its id): watched while it is open. */
  root: string
}

export class DocumentError extends Error {}

export function isMarkdown(path: string): boolean {
  return MARKDOWN.includes(extname(path).toLowerCase())
}

/** `a/b c/` → `a/b%20c/`: a folder path as URL segments. */
function urlPath(rel: string): string {
  return rel === '' ? '' : rel.split(sep).map(encodeURIComponent).join('/') + '/'
}

export function openDocument(file: string, workspace: Workspace, roots: Roots): OpenedDocument {
  // The real path: one file is one tab, however it was reached (a link, the tree, /var or /private/var).
  const path = real(resolve(file)) ?? resolve(file)
  let size: number
  try {
    const st = statSync(path)
    if (!st.isFile()) throw new DocumentError(`Not a file: ${path}`)
    size = st.size
  } catch (e) {
    if (e instanceof DocumentError) throw e
    throw new DocumentError(`Cannot open ${path}`)
  }
  if (size > MAX_BYTES) throw new DocumentError(`${basename(path)} is larger than ${MAX_BYTES / 1024 / 1024} MB`)

  // The root a document may read from: its project, Shared, or its own folder.
  const owner = workspace.ownerOf(path)
  const ownerDir = owner?.kind === 'project' ? owner.project.path : owner?.kind === 'shared' ? workspace.shared() : dirname(path)
  const rootDir = real(ownerDir) ?? ownerDir
  const id = roots.register(rootDir)
  const relDir = relative(rootDir, dirname(path))

  return {
    path,
    name: basename(path),
    text: readFileSync(path, 'utf8'),
    base: `folio://app/r/${id}/${urlPath(relDir)}`,
    folder: dirname(path),
    owner: owner?.kind ?? 'file',
    project: owner?.kind === 'project' ? owner.project.name : null,
    root: id,
  }
}

/** Options that take the next argument as their value (Electron's and Node's, e.g. a test runner's `-r loader.js`). */
const WITH_VALUE = new Set(['-r', '--require', '--inspect-port', '--user-data-dir'])

/**
 * The files to open from a command line: the arguments after the app (and
 * `.` in development) that are files — not options, not their values.
 */
export function filesFromArgv(argv: string[], cwd: string, isFile: (path: string) => boolean = fileExists): string[] {
  // After the executable; in development the app's folder (`.`) is a folder, not a file, and is passed over too.
  const args = argv.slice(1)
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (WITH_VALUE.has(a)) {
      i++
      continue
    }
    if (a.startsWith('-') || a === '.') continue
    const path = resolve(cwd, a)
    if (isFile(path)) out.push(path)
  }
  return out
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The document a link names: the file itself, or — since the kit drops `.md`
 * from relative links, as a documentation site wants — that name with a
 * Markdown extension. Null when neither is a file of the root.
 */
export function documentOfUrl(url: string, roots: Roots): string | null {
  const file = fileOfUrl(url, roots)
  if (file !== null && isMarkdown(file)) return file
  const bare = url.split(/[?#]/)[0] ?? url
  for (const ext of ['.md', '.markdown']) {
    const found = fileOfUrl(bare.replace(/\/$/, '') + ext, roots)
    if (found !== null) return found
  }
  return null
}

/** A `folio://app/r/<root>/<path>` URL back to the file it names, or null. */
export function fileOfUrl(url: string, roots: Roots): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const m = /^\/r\/([0-9a-f]{16})\/(.*)$/.exec(u.pathname)
  if (u.protocol !== 'folio:' || u.host !== 'app' || !m) return null
  const rel = decodeURIComponent(m[2] ?? '')
  return roots.resolve(m[1] ?? '', rel)
}
