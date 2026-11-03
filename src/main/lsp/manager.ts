import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Connection } from './rpc'
import { findServer, languageIdOf, userPath, type FoundServer } from './servers'

/**
 * Language servers for the files open in the code editor (ADR-003): one
 * server a project and language, started at the first file of its language,
 * told of every change (incrementally when it can take that), stopped a few
 * minutes after its last file closes. A server that falls is started again,
 * three times at most, its files opened in it again.
 */

/** A path as the file system has it (a symlinked folder, /var on macOS, resolved); a new file's by its folder. */
export function realPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    try {
      return join(realpathSync.native(dirname(path)), basename(path))
    } catch {
      return path
    }
  }
}

const URI_KEYS = new Set(['uri', 'targetUri', 'oldUri', 'newUri'])

/**
 * The file URIs in what a server sent, each of the real path: a server names
 * a file the way it walked to it, folio by its real path, and the two must
 * meet (an open file's edits go to its tab, not to the disk under it).
 */
export function realUris<T>(value: T): T {
  const real = (uri: string): string => {
    if (!uri.startsWith('file:')) return uri
    try {
      return pathToFileURL(realPath(fileURLToPath(uri))).href
    } catch {
      return uri
    }
  }
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') return key && URI_KEYS.has(key) ? real(v) : v
    if (Array.isArray(v)) return v.map((x) => walk(x))
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        // A WorkspaceEdit's changes are keyed by URI.
        if (key === 'changes') out[real(k)] = walk(x)
        else out[k] = walk(x, k)
      }
      return out
    }
    return v
  }
  return walk(value) as T
}

export interface PositionEdit {
  from: { line: number; character: number }
  to: { line: number; character: number }
  text: string
}

export interface LspDeps {
  /** The project's own wishes: a command for a language, or false for none. */
  setting(root: string, language: string): string[] | false | undefined
  /** Whether a project's own servers may run; asks the first time. */
  trust(root: string, server: string): Promise<boolean>
  diagnostics(path: string, server: string, list: unknown[]): void
  /** A server asks for edits (a rename's, an action's): the window applies them. */
  applyEdit(edit: unknown): Promise<boolean>
}

export type OpenResult =
  | { status: 'ok'; server: string; capabilities: Record<string, unknown>; real: string }
  | { status: 'none'; install: string | null }
  | { status: 'untrusted'; server: string }
  | { status: 'failed'; server: string; error: string }

const IDLE = 5 * 60 * 1000
const MAX_RESTARTS = 3
const LOG = 200_000

interface Doc {
  client: ServerClient
  languageId: string
  version: number
  text: string
}

const uriOf = (path: string): string => pathToFileURL(path).href

/** Offsets of a text's lines' starts. */
function lineStarts(text: string): number[] {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}

/** Edits (each against what the one before left) applied to a text. */
export function applyEdits(text: string, edits: readonly PositionEdit[]): string {
  for (const e of edits) {
    const starts = lineStarts(text)
    // A character past its line's end is the line's end (before its break), as the protocol says.
    const off = (p: { line: number; character: number }) => {
      if (p.line >= starts.length) return text.length
      const end = p.line + 1 < starts.length ? starts[p.line + 1]! - 1 : text.length
      return Math.min(end, starts[p.line]! + p.character)
    }
    text = text.slice(0, off(e.from)) + e.text + text.slice(off(e.to))
  }
  return text
}

class ServerClient {
  conn: Connection | null = null
  capabilities: Record<string, unknown> = {}
  ready: Promise<void> | null = null
  readonly docs = new Set<string>()
  log = ''
  private proc: ChildProcess | null = null
  private restarts = 0
  private idle: ReturnType<typeof setTimeout> | null = null
  private stopping = false

  constructor(
    readonly root: string,
    readonly found: FoundServer,
    private readonly manager: LspManager,
  ) {}

  get name(): string {
    return this.found.name
  }

  /** How it opens files: the change kind it takes (1: whole text, 2: incremental). */
  get syncKind(): number {
    const sync = this.capabilities.textDocumentSync
    if (typeof sync === 'number') return sync
    return ((sync as { change?: number } | undefined)?.change ?? 1) as number
  }

  start(): Promise<void> {
    this.ready = this.spawn()
    return this.ready
  }

  private async spawn(): Promise<void> {
    const PATH = await userPath()
    const proc = spawn(this.found.command, this.found.args, {
      cwd: this.root,
      env: { ...process.env, PATH },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.found.command),
    })
    this.proc = proc
    const conn = new Connection((bytes) => proc.stdin?.write(bytes))
    this.conn = conn
    proc.stdout?.on('data', (b: Buffer) => conn.receive(b))
    proc.stderr?.on('data', (b: Buffer) => this.note(b.toString('utf8')))
    proc.on('error', (e) => this.note(`[folio] ${e.message}\n`))
    proc.on('exit', (code) => this.exited(code))
    this.manager.wire(this, conn)
    const result = await conn.request<{ capabilities: Record<string, unknown> }>(
      'initialize',
      {
        processId: process.pid,
        clientInfo: { name: 'folio' },
        rootUri: uriOf(this.root),
        rootPath: this.root,
        workspaceFolders: [{ uri: uriOf(this.root), name: basename(this.root) }],
        capabilities: CLIENT_CAPABILITIES,
      },
      60_000,
    )
    this.capabilities = result?.capabilities ?? {}
    conn.notify('initialized', {})
  }

  note(text: string): void {
    this.log = (this.log + text).slice(-LOG)
  }

  opened(path: string): void {
    this.docs.add(path)
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
  }

  closed(path: string): void {
    this.docs.delete(path)
    if (this.docs.size === 0 && !this.idle) this.idle = setTimeout(() => void this.stop(), IDLE)
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.idle) clearTimeout(this.idle)
    this.manager.forget(this)
    const conn = this.conn
    try {
      if (conn) {
        await conn.request('shutdown', null, 3000)
        conn.notify('exit')
      }
    } catch {
      // It does not answer: it is ended all the same.
    }
    setTimeout(() => this.proc?.kill(), 500)
  }

  private exited(code: number | null): void {
    this.conn?.close()
    this.note(`[folio] the server ended (${code ?? 'signal'})\n`)
    if (this.stopping) return
    // Fallen: started again with its files, a few times, a little later each time.
    if (this.restarts < MAX_RESTARTS && this.docs.size > 0) {
      this.restarts++
      setTimeout(() => void this.manager.restart(this), 1000 * 2 ** (this.restarts - 1))
    } else this.manager.forget(this)
  }
}

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  textDocument: {
    synchronization: { didSave: true, dynamicRegistration: false },
    publishDiagnostics: { relatedInformation: false, versionSupport: false },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    completion: {
      completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], insertReplaceSupport: false, resolveSupport: { properties: ['documentation', 'detail'] } },
      contextSupport: true,
    },
    signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } },
    definition: { linkSupport: true },
    references: {},
    rename: { prepareSupport: true },
    codeAction: {
      codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] } },
      resolveSupport: { properties: ['edit'] },
    },
    formatting: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
  },
  workspace: { applyEdit: true, workspaceEdit: { documentChanges: true }, configuration: true, workspaceFolders: true, symbol: {} },
  window: { workDoneProgress: false },
}

export class LspManager {
  private readonly clients = new Map<string, ServerClient>()
  private readonly docs = new Map<string, Doc>()

  constructor(private readonly deps: LspDeps) {}

  /** A file opened in the code editor: its server found (started, trusted), the file opened in it. */
  async open(path: string, root: string, language: string, text: string): Promise<OpenResult> {
    const known = this.docs.get(path)
    if (known) await this.close(path)
    const found = await findServer(root, language, this.deps.setting(root, language))
    if ('none' in found) return { status: 'none', install: found.install }
    if (found.local && !(await this.deps.trust(root, found.name))) return { status: 'untrusted', server: found.name }
    // The server works in the real folder: the paths it names are the ones folio opens.
    const key = `${realPath(root)}\u0000${found.command}`
    let client = this.clients.get(key)
    if (!client) {
      client = new ServerClient(realPath(root), found, this)
      this.clients.set(key, client)
      try {
        await client.start()
      } catch (e) {
        this.forget(client)
        return { status: 'failed', server: found.name, error: e instanceof Error ? e.message : String(e) }
      }
    } else await client.ready
    const languageId = languageIdOf(path, language)
    this.docs.set(path, { client, languageId, version: 1, text })
    client.opened(path)
    client.conn!.notify('textDocument/didOpen', { textDocument: { uri: uriOf(path), languageId, version: 1, text } })
    return { status: 'ok', server: client.name, capabilities: client.capabilities, real: realPath(path) }
  }

  change(path: string, edits: readonly PositionEdit[]): void {
    const doc = this.docs.get(path)
    if (!doc?.client.conn) return
    doc.text = applyEdits(doc.text, edits)
    doc.version++
    const contentChanges = doc.client.syncKind === 2 ? edits.map((e) => ({ range: { start: e.from, end: e.to }, text: e.text })) : [{ text: doc.text }]
    doc.client.conn.notify('textDocument/didChange', { textDocument: { uri: uriOf(path), version: doc.version }, contentChanges })
  }

  save(path: string): void {
    const doc = this.docs.get(path)
    doc?.client.conn?.notify('textDocument/didSave', { textDocument: { uri: uriOf(path) }, text: doc.text })
  }

  async close(path: string): Promise<void> {
    const doc = this.docs.get(path)
    if (!doc) return
    this.docs.delete(path)
    doc.client.conn?.notify('textDocument/didClose', { textDocument: { uri: uriOf(path) } })
    doc.client.closed(path)
    this.deps.diagnostics(path, doc.client.name, [])
  }

  /** A request about an open file; null when it has no server or the server has nothing to say. */
  async request(path: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const doc = this.docs.get(path)
    if (!doc?.client.conn) return null
    try {
      return realUris(await doc.client.conn.request(method, { textDocument: { uri: uriOf(path) }, ...params }, 15_000))
    } catch {
      return null
    }
  }

  /** A request of the workspace (workspace/symbol, executeCommand), to the file's server. */
  async workspaceRequest(path: string, method: string, params: unknown): Promise<unknown> {
    const doc = this.docs.get(path)
    if (!doc?.client.conn) return null
    try {
      return realUris(await doc.client.conn.request(method, params, 15_000))
    } catch {
      return null
    }
  }

  /** What the file's server wrote (its stderr and folio's notes). */
  logOf(path: string): string | null {
    return this.docs.get(path)?.client.log ?? null
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.stop()))
  }

  // For the clients -----------------------------------------------------------------

  /** The server's notifications and requests, the way folio answers them. */
  wire(client: ServerClient, conn: Connection): void {
    conn.onNotification('textDocument/publishDiagnostics', (p) => {
      const { uri, diagnostics } = p as { uri: string; diagnostics: unknown[] }
      try {
        const path = new URL(uri).protocol === 'file:' ? decodeURIComponent(new URL(uri).pathname.replace(/^\/([A-Za-z]:)/, '$1')) : null
        if (path) this.deps.diagnostics(realPath(process.platform === 'win32' ? path.replace(/\//g, '\\') : path), client.name, diagnostics ?? [])
      } catch {
        // Not a file's: nothing to mark.
      }
    })
    conn.onNotification('window/logMessage', (p) => client.note(`${(p as { message: string }).message}\n`))
    conn.onNotification('window/showMessage', (p) => client.note(`${(p as { message: string }).message}\n`))
    conn.onRequest('workspace/configuration', (p) => ((p as { items?: unknown[] }).items ?? []).map(() => null))
    conn.onRequest('workspace/workspaceFolders', () => [{ uri: uriOf(client.root), name: basename(client.root) }])
    conn.onRequest('window/workDoneProgress/create', () => null)
    conn.onRequest('client/registerCapability', () => null)
    conn.onRequest('client/unregisterCapability', () => null)
    conn.onRequest('window/showMessageRequest', () => null)
    conn.onRequest('workspace/applyEdit', async (p) => ({ applied: await this.deps.applyEdit(realUris((p as { edit: unknown }).edit)) }))
  }

  forget(client: ServerClient): void {
    for (const [key, c] of this.clients) if (c === client) this.clients.delete(key)
    for (const [path, doc] of this.docs) if (doc.client === client && client.docs.size === 0) this.docs.delete(path)
  }

  /** A fallen server started again, its files opened in it again with their text. */
  async restart(client: ServerClient): Promise<void> {
    try {
      await client.start()
    } catch {
      return
    }
    for (const [path, doc] of this.docs) {
      if (doc.client !== client) continue
      doc.version = 1
      client.conn!.notify('textDocument/didOpen', { textDocument: { uri: uriOf(path), languageId: doc.languageId, version: 1, text: doc.text } })
    }
  }
}
