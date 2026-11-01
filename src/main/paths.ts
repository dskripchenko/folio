import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** `child` is `dir` itself or inside it (by the path as written). */
export function isInside(dir: string, child: string): boolean {
  const rel = relative(resolve(dir), resolve(child))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** The real path, or null when it does not exist. */
export function real(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * The file `rel` inside the root `dir`, or null when it leaves the root — by
 * `..`, by an absolute path, or through a symbolic link pointing outside.
 */
export function resolveInside(dir: string, rel: string): string | null {
  const root = real(dir)
  if (root === null) return null
  const decoded = rel.split('/').filter((p) => p !== '').join(sep)
  const candidate = resolve(root, decoded)
  if (!isInside(root, candidate)) return null
  const target = real(candidate)
  if (target === null || !isInside(root, target)) return null
  return target
}
