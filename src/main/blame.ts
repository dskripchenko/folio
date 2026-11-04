import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { diffLines } from '../common/diff'
import { historyOf, textAt, toGit } from './git'

/**
 * Who last changed each line of a file, and in which commit (ADR-002, I1):
 * by the system git when there is one (`git blame --porcelain`), else from
 * the file's history in isomorphic-git — each version against the next, a
 * line kept back to the commit that brought it.
 */
export interface BlameLine {
  /** null: not committed yet. */
  oid: string | null
  author: string
  email: string
  /** Seconds since the epoch. */
  time: number
  summary: string
}

const UNCOMMITTED: BlameLine = { oid: null, author: '', email: '', time: 0, summary: '' }

/** `git blame --porcelain`, line by line. */
export function parsePorcelain(text: string): BlameLine[] {
  const commits = new Map<string, BlameLine>()
  const out: BlameLine[] = []
  let current: { oid: string; info: Partial<BlameLine> } | null = null
  for (const line of text.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(line)
    if (head) {
      current = { oid: head[1]!, info: { ...(commits.get(head[1]!) ?? {}) } }
      continue
    }
    if (!current) continue
    if (line.startsWith('\t')) {
      const zero = /^0+$/.test(current.oid)
      const info: BlameLine = zero
        ? UNCOMMITTED
        : {
            oid: current.oid,
            author: current.info.author ?? '',
            email: current.info.email ?? '',
            time: current.info.time ?? 0,
            summary: current.info.summary ?? '',
          }
      if (!zero) commits.set(current.oid, info)
      out.push(info)
      current = null
      continue
    }
    const sp = line.indexOf(' ')
    const key = sp < 0 ? line : line.slice(0, sp)
    const value = sp < 0 ? '' : line.slice(sp + 1)
    if (key === 'author') current.info.author = value
    else if (key === 'author-mail') current.info.email = value.replace(/^<|>$/g, '')
    else if (key === 'author-time') current.info.time = Number(value)
    else if (key === 'summary') current.info.summary = value
  }
  return out
}

function systemBlame(bin: string, root: string, path: string): Promise<BlameLine[] | null> {
  return new Promise((resolve) => {
    execFile(
      bin,
      ['blame', '--porcelain', '--', toGit(root, path)],
      { cwd: root, maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout: 60_000 },
      (error, stdout) => resolve(error ? null : parsePorcelain(stdout)),
    )
  })
}

/** From the file's versions (newest first), each against the one after it. */
export async function historyBlame(root: string, path: string, depth = 200): Promise<BlameLine[]> {
  let now: string
  try {
    now = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const lf = (t: string) => t.replace(/\r\n?/g, '\n')
  const lines = lf(now).replace(/\n$/, '').split('\n')
  const owners: (BlameLine | undefined)[] = new Array(lines.length)
  // Where each line of the file now is in the newer text of the step (-1: settled).
  let pos = lines.map((_, i) => i)
  let newerText = lf(now)
  let newer: BlameLine = UNCOMMITTED
  const versions = await historyOf(root, path, depth)
  for (const v of versions) {
    const text = await textAt(root, path, v.oid)
    if (text === null) break
    const older = lf(text)
    // Lines the newer text kept from this version: newer index → older index.
    const kept = new Map<number, number>()
    let a = 0
    let b = 0
    for (const d of diffLines(older, newerText)) {
      if (d.kind === 'same') kept.set(b++, a++)
      else if (d.kind === 'del') a++
      else b++
    }
    pos = pos.map((p, i) => {
      if (p < 0) return p
      const back = kept.get(p)
      if (back === undefined) {
        owners[i] = newer
        return -1
      }
      return back
    })
    newerText = older
    newer = { oid: v.oid, author: v.author, email: v.email, time: v.time, summary: v.message.split('\n')[0] ?? '' }
  }
  // Lines as old as the oldest version read: that version's.
  return lines.map((_, i) => owners[i] ?? newer)
}

export async function blameOf(root: string, path: string, git: string | null): Promise<BlameLine[]> {
  if (git) {
    const lines = await systemBlame(git, root, path)
    if (lines) return lines
  }
  return historyBlame(root, path)
}
