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
  }
}

/** The files to open from a command line: what is after the app (and `.` in development). */
export function filesFromArgv(argv: string[], packaged: boolean, cwd: string): string[] {
  const args = argv.slice(packaged ? 1 : 2)
  return args.filter((a) => !a.startsWith('-') && a !== '.').map((a) => resolve(cwd, a))
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
