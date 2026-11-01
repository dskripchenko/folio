import type { Author } from './git'

/**
 * Commits on save, with a pause (ADR-001): a file saved again within the
 * pause makes one commit, `pause` after its last save; leaving folio commits
 * what is waiting at once. Only the saved file is committed.
 */
export interface AutoCommitDeps {
  repoOf(path: string): Promise<string | null>
  commitFile(root: string, path: string, message: string, author: Author): Promise<string | null>
  authorOf(root: string): Author
  /** The message: by the file's path within the repository. */
  message(root: string, path: string): string
  /** After a commit: the history and the tree may be shown again. */
  committed?(root: string, path: string, oid: string): void
}

export class AutoCommitter {
  private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly deps: AutoCommitDeps,
    private readonly pause = 3 * 60 * 1000,
  ) {}

  /** A file was saved: commit it once it has been quiet for the pause. */
  saved(path: string): void {
    const timer = this.waiting.get(path)
    if (timer) clearTimeout(timer)
    this.waiting.set(path, setTimeout(() => void this.commit(path), this.pause))
  }

  /** A commit made by hand takes the place of the one waiting. */
  cancel(path: string): void {
    const timer = this.waiting.get(path)
    if (timer) clearTimeout(timer)
    this.waiting.delete(path)
  }

  pending(): string[] {
    return [...this.waiting.keys()]
  }

  /** Commit what is waiting now (leaving folio). */
  async flush(): Promise<void> {
    await Promise.all(this.pending().map((path) => this.commit(path)))
  }

  private async commit(path: string): Promise<void> {
    const timer = this.waiting.get(path)
    if (timer) clearTimeout(timer)
    this.waiting.delete(path)
    const root = await this.deps.repoOf(path)
    if (root === null) return
    try {
      const oid = await this.deps.commitFile(root, path, this.deps.message(root, path), this.deps.authorOf(root))
      if (oid) this.deps.committed?.(root, path, oid)
    } catch {
      // A history that refuses (a broken repository, a lock): the file is saved all the same.
    }
  }
}
