/**
 * JSON-RPC as language servers speak it (LSP's base protocol): messages framed
 * by a `Content-Length` header, requests answered by id, notifications both
 * ways, requests from the server answered by handlers. Bytes in, bytes out —
 * the process around it is the caller's.
 */

export interface Message {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Splits a byte stream into messages: headers, a blank line, `Content-Length` bytes of JSON. */
export class Decoder {
  private buffer: Buffer = Buffer.alloc(0)

  /** Bytes as they come; the whole messages they complete. */
  push(chunk: Buffer): Message[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    const out: Message[] = []
    for (;;) {
      const end = this.buffer.indexOf('\r\n\r\n')
      if (end < 0) break
      const head = this.buffer.subarray(0, end).toString('ascii')
      const m = /content-length:\s*(\d+)/i.exec(head)
      if (!m) {
        // Not a header: dropped up to the blank line (a server's stray output).
        this.buffer = this.buffer.subarray(end + 4)
        continue
      }
      const length = Number(m[1])
      if (this.buffer.length < end + 4 + length) break
      const body = this.buffer.subarray(end + 4, end + 4 + length).toString('utf8')
      this.buffer = this.buffer.subarray(end + 4 + length)
      try {
        out.push(JSON.parse(body) as Message)
      } catch {
        // Broken JSON: that message is lost, the stream goes on.
      }
    }
    return out
  }
}

export function encode(message: Message): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

/** Requests and notifications over a writer, answers and calls from what is read. */
export class Connection {
  private next = 1
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> | null }>()
  private readonly notifications = new Map<string, (params: unknown) => void>()
  private readonly requests = new Map<string, (params: unknown) => unknown>()
  private readonly decoder = new Decoder()
  private closed = false

  constructor(private readonly write: (bytes: Buffer) => void) {}

  /** What the server wrote. */
  receive(chunk: Buffer): void {
    for (const m of this.decoder.push(chunk)) this.handle(m)
  }

  request<T = unknown>(method: string, params?: unknown, timeout = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError(-32099, 'closed'))
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      const timer = timeout > 0 ? setTimeout(() => {
        this.pending.delete(id)
        // A request that takes too long is cancelled, as the protocol lets it be.
        this.notify('$/cancelRequest', { id })
        reject(new RpcError(-32800, 'timeout'))
      }, timeout) : null
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.write(encode({ jsonrpc: '2.0', id, method, params }))
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return
    this.write(encode({ jsonrpc: '2.0', method, params }))
  }

  onNotification(method: string, fn: (params: unknown) => void): void {
    this.notifications.set(method, fn)
  }

  /** A request from the server; what `fn` returns (or resolves to) is the answer. */
  onRequest(method: string, fn: (params: unknown) => unknown): void {
    this.requests.set(method, fn)
  }

  /** The other side is gone: every request waiting fails. */
  close(): void {
    this.closed = true
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new RpcError(-32099, 'closed'))
    }
    this.pending.clear()
  }

  private handle(m: Message): void {
    if (m.method !== undefined && m.id !== undefined && m.id !== null) {
      const fn = this.requests.get(m.method)
      const id = m.id
      Promise.resolve()
        .then(() => (fn ? fn(m.params) : Promise.reject(new RpcError(-32601, `no ${m.method}`))))
        .then(
          (result) => this.write(encode({ jsonrpc: '2.0', id, result: result ?? null })),
          (e: unknown) =>
            this.write(encode({ jsonrpc: '2.0', id, error: { code: e instanceof RpcError ? e.code : -32603, message: e instanceof Error ? e.message : String(e) } })),
        )
      return
    }
    if (m.method !== undefined) {
      this.notifications.get(m.method)?.(m.params)
      return
    }
    if (typeof m.id === 'number') {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (p.timer) clearTimeout(p.timer)
      if (m.error) p.reject(new RpcError(m.error.code, m.error.message))
      else p.resolve(m.result)
    }
  }
}
