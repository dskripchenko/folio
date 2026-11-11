import { posix, win32 } from 'node:path'

/**
 * Where folio keeps its settings: beside the program, never in the user's
 * profile — deleting the folder removes everything (the portable canon).
 *
 *   FOLIO_DATA            an explicit directory (tests, a shared install)
 *   Linux AppImage        beside the .AppImage file
 *   macOS                 beside the .app bundle
 *   Windows and the rest  beside the executable
 *   not packaged          .folio-data in the working directory
 */
export interface DataDirInput {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  execPath: string
  packaged: boolean
  cwd: string
}

export const DATA_DIR = 'folio-data'

export function dataDir(input: DataDirInput): string {
  // The target platform's path rules, whatever the host runs (and tests run) on.
  const { dirname, join, resolve } = input.platform === 'win32' ? win32 : posix
  const explicit = input.env.FOLIO_DATA
  if (explicit) return resolve(input.cwd, explicit)
  if (!input.packaged) return join(input.cwd, '.folio-data')
  if (input.platform === 'linux' && input.env.APPIMAGE) return join(dirname(input.env.APPIMAGE), DATA_DIR)
  if (input.platform === 'darwin') {
    // …/Folio.app/Contents/MacOS/folio → beside Folio.app
    const bundle = input.execPath.match(/^(.*)\/[^/]+\.app\/Contents\/MacOS\/[^/]+$/)
    if (bundle) return join(bundle[1] || '/', DATA_DIR)
  }
  // electron-builder's portable Windows target unpacks to a temporary place: the original folder is given.
  const portableDir = input.env.PORTABLE_EXECUTABLE_DIR
  return join(portableDir || dirname(input.execPath), DATA_DIR)
}

/**
 * Whether macOS runs the program from a read-only copy (App Translocation):
 * a quarantined `.app` opened where it was downloaded or unpacked is started
 * from `/private/var/folders/…/AppTranslocation/<id>/d/`, where nothing can be
 * written beside it — neither `folio-data` nor an update.
 */
export function translocated(platform: NodeJS.Platform, execPath: string): boolean {
  return platform === 'darwin' && /\/AppTranslocation\/[^/]+\/[^/]+\/[^/]+\.app\/Contents\/MacOS\//.test(execPath)
}
