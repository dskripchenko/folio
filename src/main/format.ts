import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { readProjectSettings } from './projectSettings'

/**
 * Formatting on save (ADR-002, I3): the text of a file run through its
 * project's formatter before it is written — only when the project asks for
 * it (`formatOnSave` in `.folio/settings.json`) and the tool is there.
 * Known tools read the text on stdin (pint reads a copy beside the file);
 * a command of one's own does too, `{file}` naming the file.
 */

interface Run {
  bin: string
  args: string[]
  /** The tool formats a file, not stdin: a copy beside the original is given and read back. */
  copy?: boolean
}

const win = process.platform === 'win32'
const localBin = (dir: string, ...parts: string[]): string | null => {
  for (const p of win ? [join(dir, ...parts) + '.cmd', join(dir, ...parts) + '.bat', join(dir, ...parts)] : [join(dir, ...parts)]) if (existsSync(p)) return p
  return null
}
const PRETTIER = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.css', '.scss', '.less', '.json', '.md', '.yaml', '.yml', '.html', '.vue', '.graphql'])

/** A known formatter for a file, or what the project's settings name. */
export function formatterFor(dir: string, file: string, named?: string): Run | null {
  const ext = extname(file).toLowerCase()
  const want = (name: string) => !named || named === name
  // The language server formats in the window, not here.
  if (named === 'lsp') return null
  if (named && !['prettier', 'pint', 'gofmt', 'ruff', 'black', 'rustfmt'].includes(named)) {
    const command = named.replace(/\{file\}/g, JSON.stringify(file))
    return win ? { bin: 'powershell.exe', args: ['-NoProfile', '-Command', command] } : { bin: '/bin/sh', args: ['-c', command] }
  }
  const prettier = localBin(dir, 'node_modules', '.bin', 'prettier')
  if (want('prettier') && prettier && PRETTIER.has(ext)) return { bin: prettier, args: ['--stdin-filepath', file] }
  const pint = localBin(dir, 'vendor', 'bin', 'pint')
  if (want('pint') && pint && ext === '.php') return { bin: pint, args: ['--quiet'], copy: true }
  if (want('gofmt') && ext === '.go') return { bin: 'gofmt', args: [] }
  const ruff = localBin(dir, '.venv', win ? 'Scripts' : 'bin', 'ruff')
  if (want('ruff') && ext === '.py' && (ruff || named === 'ruff')) return { bin: ruff ?? 'ruff', args: ['format', '--stdin-filename', file, '-'] }
  if (want('black') && ext === '.py' && named === 'black') return { bin: 'black', args: ['-q', '--stdin-filename', file, '-'] }
  if (want('rustfmt') && ext === '.rs') return { bin: 'rustfmt', args: ['--emit', 'stdout', '--edition', '2021'] }
  return null
}

function run(spec: Run, cwd: string, input: string | null, timeout = 20_000): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      resolve(value)
    }
    let child
    try {
      child = spawn(spec.bin, spec.args, { cwd, windowsHide: true, shell: win && /\.(cmd|bat)$/i.test(spec.bin) })
    } catch {
      return finish(null)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, timeout)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (out += d))
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code === 0 ? out : null)
    })
    if (input !== null) child.stdin.end(input)
    else child.stdin.end()
  })
}

/** The text formatted; null when the project does not format on save, the tool is not there, or it failed. */
export async function formatText(projectDir: string, file: string, text: string): Promise<string | null> {
  const settings = readProjectSettings(projectDir)
  if (!settings.formatOnSave) return null
  const spec = formatterFor(projectDir, file, settings.formatter)
  if (!spec) return null
  if (!spec.copy) {
    const out = await run(spec, dirname(file), text)
    // A tool that answers nothing for a text with something in it did not format it.
    return out === null || (out === '' && text.trim() !== '') ? null : out
  }
  // A copy beside the file (the tool's settings apply to it there), formatted and read back.
  const copy = join(dirname(file), `.${basename(file, extname(file))}.folio-format${extname(file)}`)
  try {
    writeFileSync(copy, text)
    const ok = await run({ ...spec, args: [...spec.args, copy] }, projectDir, null)
    return ok === null ? null : readFileSync(copy, 'utf8')
  } catch {
    return null
  } finally {
    rmSync(copy, { force: true })
  }
}
