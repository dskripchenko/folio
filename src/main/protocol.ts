import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveInside } from './paths'
import type { Roots } from './roots'

/**
 * One scheme for folio and its documents (ADR-001): `folio://app/ui/…` is the
 * app, `folio://app/r/<root>/<path>` a file of a registered root. One origin,
 * so a document's relative pictures and `fetch`es work; nothing outside a root
 * is served.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'folio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ])
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })

export function handleScheme(session: Electron.Session, uiDir: string, roots: Roots): void {
  session.protocol.handle('folio', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app') return notFound()
    let path: string
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      return notFound()
    }
    let file: string | null = null
    if (path.startsWith('/ui/')) {
      file = resolveInside(uiDir, path.slice('/ui/'.length))
    } else {
      const m = /^\/r\/([0-9a-f]{16})\/(.*)$/.exec(path)
      if (m) file = roots.resolve(m[1] ?? '', m[2] ?? '')
    }
    if (file === null) return notFound()
    // Range and the like pass through: a video seeks in its file.
    return net.fetch(pathToFileURL(file).toString(), { headers: request.headers })
  })
}
