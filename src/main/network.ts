/**
 * The network rule of a document's window (ADR-001): its http(s) and
 * websocket requests are cancelled unless the active document's file or
 * folder is allowed. What was blocked is reported once per document and host.
 */
export interface NetworkGate {
  /** The document now shown; null when none is. */
  setActive(path: string | null): void
}

export function gateNetwork(
  session: Electron.Session,
  allows: (file: string) => boolean,
  onBlocked: (document: string, hosts: string[]) => void,
): NetworkGate {
  let active: string | null = null
  const reported = new Map<string, Set<string>>()

  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    if (active !== null && allows(active)) {
      callback({})
      return
    }
    callback({ cancel: true })
    if (active === null) return
    let host: string
    try {
      host = new URL(details.url).host
    } catch {
      return
    }
    const seen = reported.get(active) ?? new Set<string>()
    if (!seen.has(host)) {
      seen.add(host)
      reported.set(active, seen)
      onBlocked(active, [...seen])
    }
  })

  return {
    setActive(path) {
      active = path
    },
  }
}
