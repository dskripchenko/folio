import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

/**
 * A git server over HTTP for tests of the built-in transport: the system git's
 * `git http-backend`, run as CGI per request, serving the bare repositories of
 * `root`. With `login`, a request without that user and password gets 401.
 */
export async function gitServer(root: string, login?: { username: string; password: string }): Promise<{ url: string; close: () => Promise<void> }> {
  const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()
  const backend = ['git-http-backend', 'git-http-backend.exe'].map((n) => join(exec, n)).find((p) => existsSync(p))
  if (!backend) throw new Error('git http-backend not found')
  const expected = login ? `Basic ${Buffer.from(`${login.username}:${login.password}`).toString('base64')}` : null
  const server: Server = createServer((req, res) => {
    if (expected && req.headers.authorization !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const cgi = spawn(backend, [], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        REMOTE_USER: login?.username ?? '',
        REMOTE_ADDR: '127.0.0.1',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        GIT_HTTP_MAX_REQUEST_BUFFER: '100M',
      },
    })
    req.pipe(cgi.stdin)
    // CGI output: headers, a blank line, the body.
    let head = Buffer.alloc(0)
    let started = false
    cgi.stdout.on('data', (chunk: Buffer) => {
      if (started) return void res.write(chunk)
      head = Buffer.concat([head, chunk])
      const end = head.indexOf('\r\n\r\n')
      if (end < 0) return
      started = true
      let status = 200
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const i = line.indexOf(':')
        const name = line.slice(0, i).trim()
        const value = line.slice(i + 1).trim()
        if (name.toLowerCase() === 'status') status = parseInt(value, 10)
        else res.setHeader(name, value)
      }
      res.writeHead(status)
      res.write(head.subarray(end + 4))
    })
    // What the backend says when it fails: the test then shows why, not an empty answer.
    let errors = ''
    cgi.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()))
    cgi.on('close', (code) => {
      if (code !== 0 || errors) console.error(`git http-backend (${req.method} ${url.pathname}) exited with ${code}: ${errors}`)
      if (!started) res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`git http-backend exited with ${code}: ${errors || head.toString() || 'no output'}`)
      else res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) }
}
