/**
 * The review's list of files as a tree: folders first, then files, each by
 * name; a folder holding nothing but one folder shown with it as one row
 * (`src/renderer/review`), as a pull request's file tree does.
 */

export type NavRow =
  | { kind: 'dir'; path: string; name: string; depth: number }
  | { kind: 'file'; path: string; name: string; depth: number }

interface Dir {
  dirs: Map<string, Dir>
  files: string[]
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** The rows of the tree, top to bottom; a collapsed folder's insides left out. */
export function navTree(paths: string[], collapsed: ReadonlySet<string> = new Set()): NavRow[] {
  const root: Dir = { dirs: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let at = root
    for (const part of parts.slice(0, -1)) {
      let next = at.dirs.get(part)
      if (!next) at.dirs.set(part, (next = { dirs: new Map(), files: [] }))
      at = next
    }
    at.files.push(path)
  }
  const rows: NavRow[] = []
  const walk = (dir: Dir, prefix: string, depth: number) => {
    for (const name of [...dir.dirs.keys()].sort(byName)) {
      let label = name
      let inner = dir.dirs.get(name)!
      // One folder in a folder and nothing else: a row for both.
      while (inner.files.length === 0 && inner.dirs.size === 1) {
        const [only, next] = [...inner.dirs][0]!
        label += `/${only}`
        inner = next
      }
      const path = prefix + label
      rows.push({ kind: 'dir', path, name: label, depth })
      if (!collapsed.has(path)) walk(inner, `${path}/`, depth + 1)
    }
    const name = (p: string) => p.slice(p.lastIndexOf('/') + 1)
    for (const path of [...dir.files].sort((a, b) => byName(name(a), name(b)))) rows.push({ kind: 'file', path, name: name(path), depth })
  }
  walk(root, '', 0)
  return rows
}
