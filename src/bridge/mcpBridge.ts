/**
 * The bridge an agent starts to reach folio's MCP server (ADR-006, R7): the
 * agent's messages, one JSON a line on stdin, are posted to folio; folio's
 * answers go to stdout, one a line. Where folio listens and its token are read
 * from the file named by the first argument at each message, so the bridge
 * outlives folio's restarts. While folio is not running the bridge answers on
 * its own: it knows the tools, and a call says to start folio.
 *
 * Run by folio's own executable as Node (ELECTRON_RUN_AS_NODE=1); nothing but
 * Node's own modules.
 */
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { createInterface } from 'node:readline'
import { MCP_NAME, MCP_PROTOCOL, MCP_PROTOCOLS, MCP_TOOLS } from '../common/mcp'

const infoFile = process.argv[2] ?? ''

interface Info {
  url: string
  token: string
}

function info(): Info | null {
  try {
    const v = JSON.parse(readFileSync(infoFile, 'utf8')) as Partial<Info>
    return typeof v.url === 'string' && typeof v.token === 'string' ? { url: v.url, token: v.token } : null
  } catch {
    return null
  }
}

/** Posted to folio: its answer (null for none), or undefined when folio cannot be reached. */
function post(text: string, signal: AbortSignal): Promise<string | null | undefined> {
  const to = info()
  if (!to) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const req = request(to.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${to.token}` }, signal }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode === 202) resolve(null)
        else if (res.statusCode === 200) resolve(Buffer.concat(chunks).toString('utf8'))
        else resolve(undefined)
      })
      res.on('error', () => resolve(undefined))
    })
    req.on('error', () => resolve(undefined))
    req.end(text)
  })
}

/** folio not running: what the bridge answers itself. */
function alone(msg: { id?: unknown; method?: unknown; params?: { protocolVersion?: unknown } }): object | null {
  if (msg.id === undefined) return null
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion
      return ok({ protocolVersion: typeof asked === 'string' && MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: MCP_NAME, version: 'bridge' } })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: MCP_TOOLS })
    case 'tools/call':
      return ok({ content: [{ type: 'text', text: 'folio is not running: ask the person to start folio, then try again.' }], isError: true })
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }
  }
}

const write = (v: object | string) => process.stdout.write((typeof v === 'string' ? v : JSON.stringify(v)) + '\n')

// The agent gone (stdin closed): the requests still waiting are dropped, and folio stops waiting.
const quit = new AbortController()
let waiting = 0
let closed = false
const done = () => closed && waiting === 0 && process.exit(0)

createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on('line', (line) => {
    if (!line.trim()) return
    let msg: { id?: unknown; method?: unknown }
    try {
      msg = JSON.parse(line) as typeof msg
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    waiting++
    void post(line, quit.signal)
      .then((out) => {
        if (out === undefined) {
          const own = Array.isArray(msg) ? msg.map(alone).filter((x) => x !== null) : alone(msg)
          if (own !== null && !(Array.isArray(own) && own.length === 0)) write(own)
        } else if (out !== null) write(out.trim())
      })
      .finally(() => {
        waiting--
        done()
      })
  })
  .on('close', () => {
    closed = true
    quit.abort()
    done()
  })
