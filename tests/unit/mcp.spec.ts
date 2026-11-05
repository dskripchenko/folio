import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MCP_TOOLS } from '../../src/common/mcp'
import { addCommand, quote, removeCommand } from '../../src/main/review/claudeMcp'
import { McpServer, type ToolHandler } from '../../src/main/review/mcp'

let dir: string
let bridge: string
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-mcp-'))
  bridge = join(dir, 'mcp-bridge.cjs')
  await build({ entryPoints: ['src/bridge/mcpBridge.ts'], outfile: bridge, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
})
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

const post = (url: string, token: string | null, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })

/** The bridge run as an agent runs it: messages in, answers out, a line each. */
function startBridge(info: string) {
  const p = spawn(process.execPath, [bridge, info], { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines: unknown[] = []
  let rest = ''
  p.stdout.on('data', (d: Buffer) => {
    rest += d.toString()
    const parts = rest.split('\n')
    rest = parts.pop()!
    for (const l of parts) if (l.trim()) lines.push(JSON.parse(l))
  })
  const send = (m: unknown) => p.stdin.write(JSON.stringify(m) + '\n')
  const answerTo = async (id: number) => {
    for (let i = 0; i < 200; i++) {
      const found = lines.find((l) => (l as { id?: number }).id === id)
      if (found) return found as { result?: { content?: { text: string }[]; isError?: boolean; tools?: unknown[]; serverInfo?: { version: string } }; error?: unknown }
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error(`no answer to ${id}`)
  }
  return { p, lines, send, answerTo }
}

describe('folio\'s MCP server', () => {
  it('answers with its token only; initialize, the tools, a call, an unknown tool; a notification gets no answer', async () => {
    const info = join(dir, 'a.json')
    const tools: Record<string, ToolHandler> = { list_worktrees: async (args) => ({ text: `worktrees of ${String(args.repo)}` }) }
    const server = new McpServer(tools, '9.9.9')
    const { url, token } = await server.start(info)
    try {
      expect(JSON.parse(readFileSync(info, 'utf8'))).toMatchObject({ url, token })
      if (process.platform !== 'win32') expect(statSync(info).mode & 0o077).toBe(0)
      expect((await post(url, null, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
      expect((await post(url, 'nope', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)

      const init = await (await post(url, token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).json()
      expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'folio', version: '9.9.9' }, capabilities: { tools: {} } })
      expect((await post(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
      const list = await (await post(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
      expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['show_changes', 'get_review_comments', 'open_file', 'list_worktrees', 'get_app_log'])
      const call = await (await post(url, token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_worktrees', arguments: { repo: '/r' } } })).json()
      expect(call.result).toEqual({ content: [{ type: 'text', text: 'worktrees of /r' }], isError: false })
      const unknown = await (await post(url, token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'rm_rf' } })).json()
      expect(unknown.error.code).toBe(-32602)
    } finally {
      server.stop(info)
    }
  })

  it('a call that waits for the person ends when the agent goes', async () => {
    const info = join(dir, 'b.json')
    let aborted = false
    const tools: Record<string, ToolHandler> = {
      show_changes: (_args, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true
            resolve({ text: 'closed' })
          })
        }),
    }
    const server = new McpServer(tools, '1')
    await server.start(info)
    const b = startBridge(info)
    try {
      b.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'show_changes', arguments: {} } })
      await new Promise((r) => setTimeout(r, 300))
      b.p.stdin.end()
      await expect.poll(() => aborted).toBe(true)
    } finally {
      b.p.kill()
      server.stop(info)
    }
  })
})

describe('the bridge', () => {
  it('passes messages to folio and answers back; without folio it knows the tools and says to start folio', async () => {
    const info = join(dir, 'c.json')
    const b = startBridge(info)
    try {
      // folio not running.
      b.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
      expect((await b.answerTo(1)).result?.serverInfo?.version).toBe('bridge')
      b.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      b.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      expect((await b.answerTo(2)).result?.tools).toEqual(MCP_TOOLS)
      b.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_worktrees', arguments: { repo: '/r' } } })
      const alone = await b.answerTo(3)
      expect(alone.result?.isError).toBe(true)
      expect(alone.result?.content?.[0]?.text).toContain('folio is not running')

      // folio started meanwhile: the same bridge reaches it.
      const server = new McpServer({ list_worktrees: async () => ({ text: 'two' }) }, '2')
      await server.start(info)
      try {
        b.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_worktrees', arguments: { repo: '/r' } } })
        expect((await b.answerTo(4)).result?.content?.[0]?.text).toBe('two')
        b.p.stdin.write('not json\n')
        await expect.poll(() => b.lines.some((l) => (l as { error?: { code: number } }).error?.code === -32700)).toBe(true)
      } finally {
        server.stop(info)
      }
      expect(b.lines.filter((l) => (l as { id?: unknown }).id === undefined && !(l as { error?: unknown }).error)).toEqual([])
    } finally {
      b.p.kill()
    }
  })
})

describe('Claude Code\'s command', () => {
  const launch = { exe: '/Applications/folio.app/Contents/MacOS/folio', bridge: "/Users/a b/folio-data/review/mcp-bridge.cjs", info: "/Users/a b/it's/mcp.json" }
  it('adds the bridge with the local scope, the paths quoted for the shell', () => {
    expect(addCommand(launch, false)).toBe(
      "claude mcp add folio --scope local --env ELECTRON_RUN_AS_NODE=1 -- /Applications/folio.app/Contents/MacOS/folio '/Users/a b/folio-data/review/mcp-bridge.cjs' '/Users/a b/it'\\''s/mcp.json'",
    )
    expect(addCommand({ exe: 'C:\\Program Files\\folio\\folio.exe', bridge: 'C:\\f\\b.cjs', info: "C:\\it's\\mcp.json" }, true)).toBe(
      "& claude mcp add folio --scope local --env ELECTRON_RUN_AS_NODE=1 -- 'C:\\Program Files\\folio\\folio.exe' C:\\f\\b.cjs 'C:\\it''s\\mcp.json'",
    )
    expect(removeCommand(false)).toBe('claude mcp remove --scope local folio')
    expect(quote('$(rm -rf ~)', false)).toBe("'$(rm -rf ~)'")
  })
})
