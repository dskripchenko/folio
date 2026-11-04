import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorOf, branchOf, commitFile, historyOf, repoOf, startHistory, statusUnder, textAt, userFromConfig } from '../../src/main/git'
import { realish } from '../../src/main/paths'

const me = { name: 'Ann', email: 'ann@example.com' }
let dir: string
beforeEach(() => {
  dir = realish(mkdtempSync(join(tmpdir(), 'folio-git-')))
})
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('git: a history of documents', () => {
  it('starts a history of what is there, ignores what .gitignore says', async () => {
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs', 'a.md'), '# A\n')
    writeFileSync(join(dir, '.gitignore'), 'tmp/\n')
    mkdirSync(join(dir, 'tmp'))
    writeFileSync(join(dir, 'tmp', 'x.md'), 'x')
    expect(await repoOf(join(dir, 'docs'))).toBeNull()
    await startHistory(dir, me, 'Start the history')
    expect(await repoOf(join(dir, 'docs'))).toBe(dir)
    expect(await branchOf(dir)).toBe('main')
    expect((await historyOf(dir, join(dir, 'docs', 'a.md'))).map((v) => v.message)).toEqual(['Start the history'])
    expect(await historyOf(dir, join(dir, 'tmp', 'x.md'))).toEqual([])
  })

  it('commits one file, keeps its versions, and reads any of them back', async () => {
    const a = join(dir, 'a.md')
    writeFileSync(a, 'one\n')
    await startHistory(dir, me, 'Start')
    writeFileSync(a, 'two\n')
    writeFileSync(join(dir, 'b.md'), 'other\n')
    const oid = await commitFile(dir, a, 'Update a.md', me)
    expect(oid).toMatch(/^[0-9a-f]{40}$/)
    // Only that file: b.md stays new.
    expect(await statusUnder(dir, dir)).toEqual(new Map([[join(dir, 'b.md'), 'new']]))
    const versions = await historyOf(dir, a)
    expect(versions.map((v) => v.message)).toEqual(['Update a.md', 'Start'])
    expect(versions[0]).toMatchObject({ author: 'Ann', email: 'ann@example.com' })
    expect(await textAt(dir, a, versions[1]!.oid)).toBe('one\n')
    expect(await textAt(dir, a, versions[0]!.oid)).toBe('two\n')
    // Nothing changed: no commit.
    expect(await commitFile(dir, a, 'again', me)).toBeNull()
  })

  it('tells changed, new and removed files under a folder', async () => {
    mkdirSync(join(dir, 'd'))
    writeFileSync(join(dir, 'd', 'x.md'), 'x')
    writeFileSync(join(dir, 'd', 'y.md'), 'y')
    await startHistory(dir, me, 'Start')
    writeFileSync(join(dir, 'd', 'x.md'), 'x2')
    unlinkSync(join(dir, 'd', 'y.md'))
    writeFileSync(join(dir, 'd', 'z.md'), 'z')
    expect(await statusUnder(dir, join(dir, 'd'))).toEqual(
      new Map([
        [join(dir, 'd', 'x.md'), 'modified'],
        [join(dir, 'd', 'y.md'), 'deleted'],
        [join(dir, 'd', 'z.md'), 'new'],
      ]),
    )
    // A removal is committed too.
    await commitFile(dir, join(dir, 'd', 'y.md'), 'Remove y', me)
    expect((await statusUnder(dir, dir)).has(join(dir, 'd', 'y.md'))).toBe(false)
  })

  it('takes the author from the repository, then the user config, then the fallback', () => {
    expect(userFromConfig('[core]\n\tname = no\n[user]\n\tname = "Bob B"\n\temail = bob@example.com\n')).toEqual({ name: 'Bob B', email: 'bob@example.com' })
    const home = join(dir, 'home')
    mkdirSync(join(dir, 'repo', '.git'), { recursive: true })
    mkdirSync(home)
    writeFileSync(join(home, '.gitconfig'), '[user]\n  name = Home\n  email = home@example.com\n')
    writeFileSync(join(dir, 'repo', '.git', 'config'), '[user]\n  email = repo@example.com\n')
    expect(authorOf(join(dir, 'repo'), me, home)).toEqual({ name: 'Home', email: 'repo@example.com' })
    expect(authorOf(join(dir, 'nowhere'), me, join(dir, 'none'))).toEqual(me)
  })
})

describe('auto-commit with a pause', () => {
  it('makes one commit of a series of saves, after the pause; leaving commits at once', async () => {
    const { AutoCommitter } = await import('../../src/main/autoCommit')
    const a = join(dir, 'a.md')
    const b = join(dir, 'b.md')
    writeFileSync(a, 'one\n')
    writeFileSync(b, 'one\n')
    await startHistory(dir, me, 'Start')
    const committed: string[] = []
    const ac = new AutoCommitter(
      {
        repoOf,
        commitFile,
        authorOf: () => me,
        message: (_root, path) => `Update ${path.split(/[\\/]/).pop()}`,
        committed: (_r, path) => committed.push(path),
      },
      150,
    )
    writeFileSync(a, 'two\n')
    ac.saved(a)
    await new Promise((r) => setTimeout(r, 60))
    writeFileSync(a, 'three\n')
    ac.saved(a)
    await new Promise((r) => setTimeout(r, 400))
    expect((await historyOf(dir, a)).map((v) => v.message)).toEqual(['Update a.md', 'Start'])
    expect(await textAt(dir, a, (await historyOf(dir, a))[0]!.oid)).toBe('three\n')

    writeFileSync(b, 'two\n')
    ac.saved(b)
    expect(ac.pending()).toEqual([b])
    await ac.flush()
    expect(ac.pending()).toEqual([])
    expect(committed).toEqual([a, b])
  })
})

describe('history order', () => {
  it('keeps two commits of one second newest first', async () => {
    const a = join(dir, 'a.md')
    writeFileSync(a, '1\n')
    await startHistory(dir, me, 'Start')
    for (const n of [2, 3, 4]) {
      writeFileSync(a, `${n}\n`)
      await commitFile(dir, a, `v${n}`, me)
    }
    expect((await historyOf(dir, a)).map((v) => v.message)).toEqual(['v4', 'v3', 'v2', 'Start'])
  })
})
