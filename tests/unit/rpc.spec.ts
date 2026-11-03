import { describe, expect, it } from 'vitest'
import { Connection, Decoder, encode, RpcError } from '../../src/main/lsp/rpc'

describe('JSON-RPC as language servers speak it', () => {
  it('messages framed by Content-Length: split anywhere, several in a chunk, stray text dropped', () => {
    const a = encode({ jsonrpc: '2.0', method: 'a', params: { s: 'ünïcode' } })
    const b = encode({ jsonrpc: '2.0', id: 1, result: [1, 2] })
    const all = Buffer.concat([Buffer.from('noise\r\n\r\n'), a, b])
    const d = new Decoder()
    const got = []
    for (let i = 0; i < all.length; i += 7) got.push(...d.push(all.subarray(i, i + 7)))
    expect(got).toEqual([
      { jsonrpc: '2.0', method: 'a', params: { s: 'ünïcode' } },
      { jsonrpc: '2.0', id: 1, result: [1, 2] },
    ])
  })

  it('requests answered by id, errors as errors, the server’s requests answered by handlers', async () => {
    const sent: Buffer[] = []
    const c = new Connection((b) => sent.push(b))
    const one = c.request('first')
    const two = c.request('second')
    c.receive(encode({ jsonrpc: '2.0', id: 2, error: { code: -1, message: 'no' } }))
    c.receive(encode({ jsonrpc: '2.0', id: 1, result: 'yes' }))
    expect(await one).toBe('yes')
    await expect(two).rejects.toBeInstanceOf(RpcError)
    c.onRequest('workspace/configuration', (p) => (p as { items: unknown[] }).items.map(() => null))
    let told: unknown = null
    c.onNotification('textDocument/publishDiagnostics', (p) => (told = p))
    c.receive(encode({ jsonrpc: '2.0', id: 9, method: 'workspace/configuration', params: { items: [{}, {}] } }))
    c.receive(encode({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'x' } }))
    await new Promise((r) => setTimeout(r, 0))
    const answer = new Decoder().push(Buffer.concat(sent)).find((m) => m.id === 9)
    expect(answer).toEqual({ jsonrpc: '2.0', id: 9, result: [null, null] })
    expect(told).toEqual({ uri: 'x' })
    const late = c.request('third')
    c.close()
    await expect(late).rejects.toThrow('closed')
  })
})
