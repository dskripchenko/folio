/* global process, Buffer */
// A language server of a few lines for the tests: answers each request the same simple way
// (diagnostics on the word "bad", a definition at "function <name>", renames across the project).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const docs = new Map()
let buffer = Buffer.alloc(0)
let root = process.cwd()

const send = (msg) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }))
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n')
    if (end < 0) return
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + length) return
    const msg = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    handle(msg)
  }
})

const lines = (text) => text.split('\n')
const offsetOf = (text, p) => lines(text).slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character
const positionOf = (text, offset) => {
  const before = text.slice(0, offset).split('\n')
  return { line: before.length - 1, character: before[before.length - 1].length }
}
const wordAt = (text, p) => {
  const line = lines(text)[p.line] ?? ''
  for (const m of line.matchAll(/[A-Za-z_$][\w$]*/g)) if (m.index <= p.character && p.character <= m.index + m[0].length) return { word: m[0], start: m.index }
  return null
}
const occurrences = (text, word) => [...text.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].map((m) => ({ start: positionOf(text, m.index), end: positionOf(text, m.index + word.length) }))
/** The project's files with their text: open ones as the editor has them, others from disk. */
const files = () => {
  const out = new Map()
  for (const name of readdirSync(root)) if (/\.(js|ts)$/.test(name)) out.set(pathToFileURL(join(root, name)).href, readFileSync(join(root, name), 'utf8'))
  for (const [uri, text] of docs) out.set(uri, text)
  return out
}

const diagnose = (uri) => {
  const text = docs.get(uri)
  send({
    method: 'textDocument/publishDiagnostics',
    params: { uri, diagnostics: occurrences(text, 'bad').map((range) => ({ range, severity: 1, source: 'fake', message: 'bad is not allowed' })) },
  })
}

function handle(msg) {
  const { id, method, params } = msg
  const reply = (result) => send({ id, result })
  const text = params?.textDocument ? docs.get(params.textDocument.uri) : undefined
  switch (method) {
    case 'initialize':
      root = params.rootUri ? fileURLToPath(params.rootUri) : root
      return reply({
        capabilities: {
          textDocumentSync: { openClose: true, change: 2, save: true },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          renameProvider: { prepareProvider: true },
          completionProvider: { triggerCharacters: ['.'] },
          signatureHelpProvider: { triggerCharacters: ['(', ','] },
          codeActionProvider: true,
          documentFormattingProvider: true,
          documentSymbolProvider: true,
        },
        serverInfo: { name: 'fake-lsp' },
      })
    case 'initialized':
      return process.stderr.write('fake-lsp: ready\n')
    case 'shutdown':
      return reply(null)
    case 'exit':
      return process.exit(0)
    case 'textDocument/didOpen':
      docs.set(params.textDocument.uri, params.textDocument.text)
      return diagnose(params.textDocument.uri)
    case 'textDocument/didChange': {
      let t = docs.get(params.textDocument.uri)
      for (const c of params.contentChanges) t = c.range ? t.slice(0, offsetOf(t, c.range.start)) + c.text + t.slice(offsetOf(t, c.range.end)) : c.text
      docs.set(params.textDocument.uri, t)
      return diagnose(params.textDocument.uri)
    }
    case 'textDocument/didClose':
      return docs.delete(params.textDocument.uri)
    case 'textDocument/hover': {
      const w = wordAt(text, params.position)
      return reply(w ? { contents: { kind: 'markdown', value: `**${w.word}**: a fake type` } } : null)
    }
    case 'textDocument/definition': {
      const w = wordAt(text, params.position)
      if (!w) return reply(null)
      for (const [uri, t] of files()) {
        const i = t.search(new RegExp(`function ${w.word}\\b`))
        if (i >= 0) return reply([{ uri, range: { start: positionOf(t, i + 9), end: positionOf(t, i + 9 + w.word.length) } }])
      }
      return reply(null)
    }
    case 'textDocument/references': {
      const w = wordAt(text, params.position)
      return reply(w ? [...files()].flatMap(([uri, t]) => occurrences(t, w.word).map((range) => ({ uri, range }))) : [])
    }
    case 'textDocument/prepareRename': {
      const w = wordAt(text, params.position)
      return reply(w ? { start: { line: params.position.line, character: w.start }, end: { line: params.position.line, character: w.start + w.word.length } } : null)
    }
    case 'textDocument/rename': {
      const w = wordAt(text, params.position)
      const changes = {}
      if (w) for (const [uri, t] of files()) {
        const list = occurrences(t, w.word)
        if (list.length) changes[uri] = list.map((range) => ({ range, newText: params.newName }))
      }
      return reply({ changes })
    }
    case 'textDocument/completion':
      return reply({ isIncomplete: false, items: [{ label: 'fromServer', kind: 3, detail: 'fake', insertTextFormat: 2, insertText: 'fromServer(${1:arg})' }] })
    case 'textDocument/signatureHelp':
      return reply({ signatures: [{ label: 'greet(name: string)', parameters: [{ label: 'name: string' }] }], activeSignature: 0, activeParameter: 0 })
    case 'textDocument/codeAction':
      return reply(
        params.context.diagnostics.map((d) => ({ title: 'Replace bad with good', kind: 'quickfix', edit: { changes: { [params.textDocument.uri]: [{ range: d.range, newText: 'good' }] } } })),
      )
    case 'textDocument/formatting': {
      const ls = lines(text)
      return reply(ls.flatMap((l, i) => (/ {2,}/.test(l) ? [{ range: { start: { line: i, character: 0 }, end: { line: i, character: l.length } }, newText: l.replace(/ {2,}/g, ' ') }] : [])))
    }
    case 'textDocument/documentSymbol':
      return reply(
        [...text.matchAll(/function (\w+)/g)].map((m) => {
          const start = positionOf(text, m.index)
          return { name: `${m[1]} (server)`, kind: 12, range: { start, end: start }, selectionRange: { start, end: start } }
        }),
      )
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `no ${method}` } })
  }
}
