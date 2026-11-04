import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { commentOf, type ReviewComment } from '../../common/review'
import { readJson, writeJson } from '../jsonFile'

/**
 * What the review keeps of a repository (ADR-006) in `folio-data/review`:
 * files marked as viewed (by their texts' hash: changed again, unmarked), and
 * later checkpoints and comments. One file a repository, by its path's hash.
 */
export interface RepoReview {
  /** `<set>|<path>` → the hash of the texts that were viewed. */
  viewed: Record<string, string>
  /** Comments on lines, to send to an agent (R5). */
  comments: ReviewComment[]
}

/**
 * What was looked at (ADR-006, R3): the commit then, and the text of each
 * file that differed from it (null: the file was not there). A file not named
 * is as the commit had it.
 */
export interface Checkpoint {
  head: string | null
  time: number
  files: Record<string, string | null>
}

export class ReviewStore {
  private readonly cache = new Map<string, RepoReview>()

  constructor(private readonly dir: string) {}

  private file(root: string): string {
    return join(this.dir, `${createHash('sha1').update(root).digest('hex').slice(0, 16)}.json`)
  }

  of(root: string): RepoReview {
    let r = this.cache.get(root)
    if (!r) {
      const loaded = readJson<Partial<RepoReview>>(this.file(root), {})
      r = {
        viewed: loaded.viewed && typeof loaded.viewed === 'object' ? loaded.viewed : {},
        comments: Array.isArray(loaded.comments) ? loaded.comments.map(commentOf).filter((c) => c !== null) : [],
      }
      this.cache.set(root, r)
    }
    return r
  }

  /** Where Claude Code's hook writes the repository's edits (R6). */
  eventsFile(root: string): string {
    return join(this.dir, 'events', `${createHash('sha1').update(root).digest('hex').slice(0, 16)}.jsonl`)
  }

  private checkpointFile(root: string): string {
    return this.file(root).replace(/\.json$/, '.checkpoint.json')
  }

  checkpoint(root: string): Checkpoint | null {
    const c = readJson<Partial<Checkpoint> | null>(this.checkpointFile(root), null)
    if (!c || typeof c.time !== 'number' || !c.files || typeof c.files !== 'object') return null
    return { head: typeof c.head === 'string' ? c.head : null, time: c.time, files: c.files }
  }

  setCheckpoint(root: string, c: Checkpoint): void {
    writeJson(this.checkpointFile(root), c)
  }

  /** A comment made or changed (by its id); null text: removed. */
  saveComment(root: string, c: ReviewComment): void {
    const r = this.of(root)
    const i = r.comments.findIndex((x) => x.id === c.id)
    if (i >= 0) r.comments[i] = c
    else r.comments.push(c)
    r.comments.splice(0, Math.max(0, r.comments.length - 2000))
    writeJson(this.file(root), r)
  }

  deleteComments(root: string, ids: readonly string[]): void {
    const r = this.of(root)
    r.comments = r.comments.filter((c) => !ids.includes(c.id))
    writeJson(this.file(root), r)
  }

  markSent(root: string, ids: readonly string[]): void {
    const r = this.of(root)
    for (const c of r.comments) if (ids.includes(c.id)) c.sent = true
    writeJson(this.file(root), r)
  }

  setViewed(root: string, key: string, hash: string | null): void {
    const r = this.of(root)
    if (hash === null) delete r.viewed[key]
    else r.viewed[key] = hash
    // A repository's marks kept within reason: the oldest go first.
    const keys = Object.keys(r.viewed)
    for (const k of keys.slice(0, Math.max(0, keys.length - 5000))) delete r.viewed[k]
    writeJson(this.file(root), r)
  }
}
