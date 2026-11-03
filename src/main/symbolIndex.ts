import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { flattenSymbols, languageOf, symbols } from '@dskripchenko/syntax'

/**
 * The symbols of every project's code (ADR-002, I2): each file's read once
 * and kept until it changes on disk, for going to a symbol across projects
 * and for completing names. Big files (past a megabyte) and documents are
 * left out: a project's code is what is looked for.
 */
export interface ProjectSymbol {
  root: string
  label: string | null
  path: string
  name: string
  kind: string
  container: string
  /** 0-based. */
  line: number
  column: number
}

export interface SourceFile {
  root: string
  label: string | null
  dir: string
  path: string
}

const MAX_BYTES = 1024 * 1024
/** Kinds of symbol worth going to across files (not every key of every config). */
const WORTH = new Set(['class', 'interface', 'struct', 'enum', 'trait', 'type', 'function', 'method', 'constructor', 'constant', 'module', 'namespace', 'table', 'target'])
/** Languages whose files are documents or data, not code. */
const NOT_CODE = new Set(['markdown', 'json', 'jsonc', 'jsonl', 'yaml', 'toml', 'ini', 'dotenv', 'csv', 'log', 'diff', 'xml', 'html', 'latex', 'http'])

export class SymbolIndex {
  private readonly cache = new Map<string, { mtime: number; list: Omit<ProjectSymbol, 'root' | 'label' | 'path'>[] }>()

  async symbolsOf(files: readonly SourceFile[], limit = 100_000): Promise<ProjectSymbol[]> {
    const out: ProjectSymbol[] = []
    let since = Date.now()
    for (const f of files) {
      const language = languageOf(f.path)
      if (!language || NOT_CODE.has(language)) continue
      const full = join(f.dir, ...f.path.split('/'))
      let st
      try {
        st = await stat(full)
      } catch {
        continue
      }
      if (st.size > MAX_BYTES) continue
      let hit = this.cache.get(full)
      if (!hit || hit.mtime !== st.mtimeMs) {
        let text: string
        try {
          text = await readFile(full, 'utf8')
        } catch {
          continue
        }
        const list = flattenSymbols(symbols(text, language))
          .filter((s) => WORTH.has(s.kind))
          .map((s) => ({ name: s.name, kind: s.kind, container: s.container, line: s.line - 1, column: s.column }))
        hit = { mtime: st.mtimeMs, list }
        this.cache.set(full, hit)
      }
      for (const s of hit.list) out.push({ root: f.root, label: f.label, path: f.path, ...s })
      if (out.length >= limit) break
      // Room for the window's other requests while a big set of files is read the first time.
      if (Date.now() - since > 30) {
        await new Promise((r) => setImmediate(r))
        since = Date.now()
      }
    }
    return out
  }
}
