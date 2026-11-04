import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { MCP_NAME, MCP_PROTOCOL, MCP_PROTOCOLS, MCP_TOOLS } from '../../common/mcp'

/**
 * folio's MCP server (ADR-006, R7): JSON-RPC over HTTP on 127.0.0.1, a token
 * in every request. Where it listens and the token are in a file of
 * folio-data that only its user reads; the bridge an agent starts reads it
 * and passes the agent's messages on. Answers are JSON, never a stream: a
 * call that waits for the person (show_changes) holds its request open.
 */

export type ToolResult = { text: string; error?: boolean }
export type ToolHandler = (args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>

interface Rpc {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })
const failure = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** One message: its answer, or null for a notification. */
export async function answer(msg: Rpc, tools: Record<string, ToolHandler>, version: string, signal: AbortSignal): Promise<object | null> {
  if (typeof msg !== 'object' || msg === null || typeof msg.method !== 'string') return failure(null, -32600, 'Invalid request')
  const notification = msg.id === undefined
  if (notification) return null
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion
      return reply(msg.id, {
        protocolVersion: typeof asked === 'string' && MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: MCP_NAME, version },
        instructions: 'folio shows changes to the person who reviews them. When work is ready to be looked at, call show_changes and wait for the answer.',
      })
    }
    case 'ping':
      return reply(msg.id, {})
    case 'tools/list':
      return reply(msg.id, { tools: MCP_TOOLS })
    case 'tools/call': {
      const name = msg.params?.name
      const args = msg.params?.arguments
      const tool = typeof name === 'string' ? tools[name] : undefined
      if (!tool) return failure(msg.id, -32602, `Unknown tool: ${String(name)}`)
      try {
        const r = await tool(typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}, signal)
        return reply(msg.id, { content: [{ type: 'text', text: r.text }], isError: r.error === true })
      } catch (e) {
        return reply(msg.id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    default:
      return failure(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

function body(req: IncomingMessage, limit = 1 << 20): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export interface McpInfo {
  url: string
  token: string
  pid: number
}

export class McpServer {
  private server: Server | null = null
  private readonly token = randomBytes(24).toString('hex')

  constructor(
    private readonly tools: Record<string, ToolHandler>,
    private readonly version: string,
  ) {}

  /** Listens, and writes where (with the token) to `infoFile`. */
  async start(infoFile: string): Promise<McpInfo> {
    const expected = Buffer.from(`Bearer ${this.token}`)
    const server = createServer((req, res) => {
      const auth = Buffer.from(req.headers.authorization ?? '')
      // Only folio's bridge (it has the token); a page in a browser cannot send it, nor read an answer.
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return void res.writeHead(401).end()
      if (req.method !== 'POST' || req.url !== '/mcp') return void res.writeHead(404).end()
      // The agent gone (its bridge closed the request): a wait for the person ends.
      const gone = new AbortController()
      res.on('close', () => res.writableFinished || gone.abort())
      void body(req)
        .then(async (text) => {
          const msg = JSON.parse(text) as Rpc | Rpc[]
          const out = Array.isArray(msg)
            ? (await Promise.all(msg.map((m) => answer(m, this.tools, this.version, gone.signal)))).filter((x) => x !== null)
            : await answer(msg, this.tools, this.version, gone.signal)
          if (out === null || (Array.isArray(out) && out.length === 0)) return void res.writeHead(202).end()
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out))
        })
        .catch(() => res.writableEnded || res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(failure(null, -32700, 'Parse error'))))
    })
    // A wait for the person may be long: no timeouts of the server's own.
    server.requestTimeout = 0
    server.headersTimeout = 60_000
    server.keepAliveTimeout = 5_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    const info: McpInfo = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, token: this.token, pid: process.pid }
    mkdirSync(dirname(infoFile), { recursive: true })
    writeFileSync(infoFile, JSON.stringify(info), { mode: 0o600 })
    try {
      chmodSync(infoFile, 0o600)
    } catch {
      // Windows: the file is in the user's own folder.
    }
    return info
  }

  stop(infoFile: string): void {
    this.server?.close()
    this.server?.closeAllConnections()
    this.server = null
    rmSync(infoFile, { force: true })
  }
}
