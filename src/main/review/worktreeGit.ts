import { existsSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Change, Changes } from '../changes'
import type { Author, Branches, Version } from '../git'
import { GitError } from '../git'
import { ReviewGit } from './git'

/**
 * A worktree opened as a project (ADR-006, R4): isomorphic-git cannot read
 * one (its `.git` is a file naming a folder of the main repository), so the
 * changes panel, the gutter's marks and the history go through the system's
 * git there — the same answers in the same shapes.
 */
export class WorktreeGit {
  private readonly g: ReviewGit

  constructor(bin: string) {
    this.g = new ReviewGit(bin)
  }

  private rel(root: string, path: string): string {
    return relative(root, path).split(sep).join('/')
  }

  async branches(root: string): Promise<Branches> {
    const current = await this.g.currentBranch(root)
    const out = await this.g.run(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).catch(() => '')
    return { current, local: out.split('\n').filter(Boolean) }
  }

  /** `status --porcelain=v1 -z`: XY and a path (a rename: then its old path). */
  async changes(root: string): Promise<Changes> {
    const parts = (await this.g.run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0')
    const staged: Change[] = []
    const unstaged: Change[] = []
    const kind = (c: string): Change['kind'] | null => (c === 'A' ? 'added' : c === 'D' ? 'deleted' : c === 'M' || c === 'R' || c === 'C' || c === 'T' ? 'modified' : null)
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]!
      if (entry.length < 4) continue
      const x = entry[0]!
      const y = entry[1]!
      const path = entry.slice(3)
      if (x === 'R' || x === 'C') i++
      if (x === '?' && y === '?') {
        // A repository inside (a worktree): not a file of this one.
        if (path.endsWith('/')) continue
        unstaged.push({ path, kind: 'untracked' })
        continue
      }
      const s = kind(x)
      if (s) staged.push({ path, kind: s })
      const u = kind(y)
      if (u) unstaged.push({ path, kind: u })
    }
    const order = (a: Change, b: Change) => a.path.localeCompare(b.path)
    return { staged: staged.sort(order), unstaged: unstaged.sort(order) }
  }

  async stage(root: string, paths: readonly string[]): Promise<void> {
    await this.g.run(root, ['add', '-A', '--', ...paths])
  }

  async unstage(root: string, paths: readonly string[]): Promise<void> {
    const head = await this.g.resolve(root, 'HEAD')
    await this.g.run(root, head ? ['reset', '-q', 'HEAD', '--', ...paths] : ['rm', '--cached', '-q', '--', ...paths])
  }

  /** Back to the last commit (a file new to git: removed). */
  async discard(root: string, path: string): Promise<void> {
    const head = await this.g.resolve(root, 'HEAD')
    if (head && (await this.g.textAt(root, head, path)) !== null) {
      await this.g.run(root, ['checkout', head, '--', path])
      return
    }
    await this.g.run(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', path])
    const file = join(root, ...path.split('/'))
    if (existsSync(file)) rmSync(file, { force: true })
  }

  async commit(root: string, message: string, author: Author, amend: boolean): Promise<string | null> {
    const staged = (await this.changes(root)).staged.length
    if (!staged && !amend) return null
    try {
      await this.g.run(root, ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-q', ...(amend ? ['--amend'] : []), '-m', message])
    } catch (e) {
      throw e instanceof GitError ? e : new GitError('failed')
    }
    return this.g.resolve(root, 'HEAD')
  }

  async headText(root: string, path: string): Promise<string | null> {
    const head = await this.g.resolve(root, 'HEAD')
    return head ? this.g.textAt(root, head, this.rel(root, path)) : null
  }

  async textAt(root: string, path: string, oid: string): Promise<string | null> {
    return this.g.textAt(root, oid, this.rel(root, path))
  }

  /** The file's commits (`path`), or the branch's, newest first. */
  async history(root: string, path: string | null, limit = 300): Promise<Version[]> {
    const args = ['log', `-${limit}`, '--format=%H%x00%P%x00%an%x00%ae%x00%ct%x00%D%x00%B%x1e']
    if (path) args.push('--follow', '--', this.rel(root, path))
    const out = await this.g.run(root, args).catch(() => '')
    return out
      .split('\x1e')
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [oid = '', parents = '', author = '', email = '', time = '0', refs = '', ...message] = r.split('\0')
        return {
          oid,
          parents: parents.split(' ').filter(Boolean),
          author,
          email,
          time: Number(time),
          refs: refs.split(', ').map((x) => x.replace(/^HEAD -> /, '').replace(/^tag: /, '')).filter((x) => x && x !== 'HEAD'),
          message: message.join('\0').trimEnd(),
        }
      })
  }
}
