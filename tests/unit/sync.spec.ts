import { execFileSync } from 'node:child_process'
import { createTag } from '../../src/main/gitOps'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  abortMerge,
  aheadBehind,
  branchesOf,
  commitFile,
  conflictsOf,
  createBranch,
  finishMerge,
  GitError,
  historyOf,
  mergeHead,
  remoteOf,
  setRemote,
  startHistory,
  switchBranch,
} from '../../src/main/git'
import { realish } from '../../src/main/paths'
import { builtinTransport, classify, cloneInto, cloneTarget, syncRepo, systemTransport, type Transport } from '../../src/main/sync'
import { gitServer } from './gitServer'

const me = { name: 'Ann', email: 'ann@example.com' }
const bobAuthor = { name: 'Bob', email: 'bob@example.com' }
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

let dir: string
beforeEach(() => {
  dir = realish(mkdtempSync(join(tmpdir(), 'folio-sync-')))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const refusal = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(GitError)
    return e as GitError
  }
  throw new Error('not refused')
}

describe('branches', () => {
  it('creates and switches branches; refuses to switch over unsaved history', async () => {
    const a = join(dir, 'a.md')
    writeFileSync(a, 'one\n')
    await startHistory(dir, me, 'Start')
    await createBranch(dir, 'draft')
    writeFileSync(a, 'draft\n')
    await commitFile(dir, a, 'Draft', me)
    expect(await branchesOf(dir)).toEqual({ current: 'draft', local: ['draft', 'main'] })
    await switchBranch(dir, 'main')
    expect(readFileSync(a, 'utf8')).toBe('one\n')
    writeFileSync(a, 'unsaved\n')
    const e = await refusal(switchBranch(dir, 'draft'))
    expect(e.code).toBe('dirty')
    expect(e.detail).toEqual([a])
    expect((await refusal(createBranch(dir, 'main'))).code).toBe('exists')
    expect((await refusal(createBranch(dir, 'bad name'))).code).toBe('invalid')
  })
})

/** A bare remote, Ann's folder (started in folio) pushed to it, and Bob's clone. */
async function twoSides(transport: (root: string) => Transport, url: (bare: string) => string) {
  const bare = join(dir, 'remote.git')
  sh(dir, 'init', '--bare', '--initial-branch=main', bare)
  // Anonymous pushes, for the HTTP server of the tests.
  sh(bare, 'config', 'http.receivepack', 'true')
  const ann = join(dir, 'ann')
  const bobDir = join(dir, 'bob')
  execFileSync('git', ['init', ann])
  rmSync(join(ann, '.git'), { recursive: true })
  writeFileSync(join(ann, 'notes.md'), '# Notes\n\nfirst\nsecond\nthird\n')
  await startHistory(ann, me, 'Start')
  await setRemote(ann, url(bare))
  expect(await syncRepo(ann, transport(ann), me)).toEqual({ result: 'pushed' })
  await cloneInto(transport(bobDir), url(bare), bobDir)
  return { bare, ann, bob: bobDir }
}

function suite(name: string, make: () => Promise<{ transport: (root: string) => Transport; url: (bare: string) => string; done?: () => Promise<void> }>) {
  describe(`sync, ${name}`, () => {
    it('pushes, pulls fast-forward, merges; then says it is up to date', async () => {
      const t = await make()
      try {
        const { ann, bob } = await twoSides(t.transport, t.url)
        expect(readFileSync(join(bob, 'notes.md'), 'utf8')).toContain('second')

        // Bob changes, Ann pulls.
        writeFileSync(join(bob, 'notes.md'), '# Notes\n\nfirst\nsecond (Bob)\nthird\n')
        await commitFile(bob, join(bob, 'notes.md'), 'Bob edits', bobAuthor)
        expect(await syncRepo(bob, t.transport(bob), bobAuthor)).toEqual({ result: 'pushed' })
        expect(await syncRepo(ann, t.transport(ann), me)).toEqual({ result: 'pulled' })
        expect(readFileSync(join(ann, 'notes.md'), 'utf8')).toContain('second (Bob)')

        // Both change different lines: a merge commit, pushed.
        writeFileSync(join(ann, 'notes.md'), '# Notes\n\nfirst (Ann)\nsecond (Bob)\nthird\n')
        await commitFile(ann, join(ann, 'notes.md'), 'Ann edits', me)
        writeFileSync(join(bob, 'notes.md'), '# Notes\n\nfirst\nsecond (Bob)\nthird (Bob)\n')
        await commitFile(bob, join(bob, 'notes.md'), 'Bob again', bobAuthor)
        await syncRepo(bob, t.transport(bob), bobAuthor)
        expect(await syncRepo(ann, t.transport(ann), me)).toEqual({ result: 'merged' })
        expect(readFileSync(join(ann, 'notes.md'), 'utf8')).toBe('# Notes\n\nfirst (Ann)\nsecond (Bob)\nthird (Bob)\n')
        expect((await historyOf(ann, join(ann, 'notes.md')))[0]!.message).toMatch(/^Merge origin\/main into main/)
        expect(await aheadBehind(ann, 'main', 'origin')).toEqual({ ahead: 0, behind: 0 })
        expect(await syncRepo(ann, t.transport(ann), me)).toEqual({ result: 'up-to-date' })
        expect(await syncRepo(bob, t.transport(bob), bobAuthor)).toEqual({ result: 'pulled' })

        // A tag made here goes out with the next sync, even with nothing else to send.
        await createTag(ann, 'v1.0.0', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ann }).toString().trim(), 'First release', me)
        expect(await syncRepo(ann, t.transport(ann), me)).toEqual({ result: 'up-to-date' })
        expect(sh(dir, '--git-dir', join(dir, 'remote.git'), 'tag', '--list')).toContain('v1.0.0')
      } finally {
        await t.done?.()
      }
    })

    it('leaves a conflict in the text; finishing needs the markers gone; aborting restores', async () => {
      const t = await make()
      try {
        const { ann, bob } = await twoSides(t.transport, t.url)
        const file = join(ann, 'notes.md')
        writeFileSync(join(bob, 'notes.md'), '# Notes\n\nfirst\nBob says\nthird\n')
        await commitFile(bob, join(bob, 'notes.md'), 'Bob', bobAuthor)
        await syncRepo(bob, t.transport(bob), bobAuthor)
        writeFileSync(file, '# Notes\n\nfirst\nAnn says\nthird\n')
        await commitFile(ann, file, 'Ann', me)

        const result = await syncRepo(ann, t.transport(ann), me)
        expect(result).toEqual({ result: 'conflict', conflicts: [file] })
        expect(readFileSync(file, 'utf8')).toMatch(/<<<<<<< [^\n]*\nAnn says\n=======\nBob says\n>>>>>>> /)
        expect(mergeHead(ann)).toMatch(/^[0-9a-f]{40}$/)
        expect(await conflictsOf(ann)).toEqual([file])
        // No commits on a file while merging, no second sync.
        expect((await refusal(syncRepo(ann, t.transport(ann), me))).code).toBe('merging')
        expect((await refusal(finishMerge(ann, me))).code).toBe('markers')
        // The system git sees the same merge.
        expect(sh(ann, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toBe(mergeHead(ann))

        // Abort: back to Ann's version.
        await abortMerge(ann)
        expect(mergeHead(ann)).toBeNull()
        expect(readFileSync(file, 'utf8')).toBe('# Notes\n\nfirst\nAnn says\nthird\n')

        // Again, resolved by hand this time.
        await syncRepo(ann, t.transport(ann), me)
        writeFileSync(file, '# Notes\n\nfirst\nAnn and Bob say\nthird\n')
        expect(await conflictsOf(ann)).toEqual([])
        await finishMerge(ann, me)
        expect(mergeHead(ann)).toBeNull()
        expect(sh(ann, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2)
        expect(sh(ann, 'status', '--porcelain')).toBe('')
        expect(await syncRepo(ann, t.transport(ann), me)).toEqual({ result: 'pushed' })
        expect(await syncRepo(bob, t.transport(bob), bobAuthor)).toEqual({ result: 'pulled' })
        expect(readFileSync(join(bob, 'notes.md'), 'utf8')).toContain('Ann and Bob say')
      } finally {
        await t.done?.()
      }
    })

    it('refuses with unsaved changes, without a remote, and without a branch', async () => {
      const t = await make()
      try {
        writeFileSync(join(dir, 'a.md'), 'a\n')
        await startHistory(dir, me, 'Start')
        expect((await refusal(syncRepo(dir, t.transport(dir), me))).code).toBe('no-remote')
        await setRemote(dir, t.url(join(dir, 'nowhere.git')))
        expect(await remoteOf(dir)).toEqual({ name: 'origin', url: t.url(join(dir, 'nowhere.git')).replaceAll('\\', '/') })
        writeFileSync(join(dir, 'a.md'), 'b\n')
        expect((await refusal(syncRepo(dir, t.transport(dir), me))).code).toBe('dirty')
      } finally {
        await t.done?.()
      }
    })
  })
}

suite('system git', async () => {
  const t = systemTransport('git')
  return { transport: () => t, url: (bare) => bare }
})

suite('built-in, over HTTP', async () => {
  const server = await gitServer(dir)
  const t = builtinTransport(() => undefined)
  return { transport: () => t, url: (bare) => `${server.url}/${bare.slice(dir.length + 1).replaceAll('\\', '/')}`, done: server.close }
})

describe('the built-in transport and logins', () => {
  it('asks for a login, then works with it', async () => {
    const bare = join(dir, 'private.git')
    sh(dir, 'init', '--bare', '--initial-branch=main', bare)
    const server = await gitServer(dir, { username: 'ann', password: 'token-1' })
    try {
      const url = `${server.url}/private.git`
      const work = join(dir, 'work')
      execFileSync('git', ['init', work])
      rmSync(join(work, '.git'), { recursive: true })
      writeFileSync(join(work, 'a.md'), 'a\n')
      await startHistory(work, me, 'Start')
      await setRemote(work, url)
      const e = await refusal(syncRepo(work, builtinTransport(() => undefined), me))
      expect(e.code).toBe('auth')
      expect(e.detail).toEqual([server.url])
      const wrong = await refusal(syncRepo(work, builtinTransport(() => ({ username: 'ann', password: 'nope' })), me))
      expect(wrong.code).toBe('auth')
      expect(await syncRepo(work, builtinTransport(() => ({ username: 'ann', password: 'token-1' })), me)).toEqual({ result: 'pushed' })
      expect(sh(bare, 'log', '--format=%s', 'main')).toBe('Start')
    } finally {
      await server.close()
    }
  })

  it('says only https works without git, for other addresses', async () => {
    writeFileSync(join(dir, 'a.md'), 'a\n')
    await startHistory(dir, me, 'Start')
    await setRemote(dir, 'git@example.com:me/notes.git')
    const e = await refusal(syncRepo(dir, builtinTransport(() => undefined), me))
    expect(e.code).toBe('network')
    expect(e.detail[0]).toMatch(/only https/)
  })
})

describe('sync helpers', () => {
  it('keeps a local path readable by the system git (no backslashes in its config)', async () => {
    const { remoteUrl } = await import('../../src/main/git')
    expect(remoteUrl('C:\\Users\\ann\\team.git')).toBe('C:/Users/ann/team.git')
    expect(remoteUrl('https://example.com/a.git')).toBe('https://example.com/a.git')
    expect(remoteUrl('git@example.com:me/a.git')).toBe('git@example.com:me/a.git')
  })

  it('names the clone after the repository', () => {
    expect(cloneTarget('/p', 'https://github.com/me/notes.git')).toBe(join('/p', 'notes'))
    expect(cloneTarget('/p', 'git@github.com:me/handbook.git')).toBe(join('/p', 'handbook'))
    expect(cloneTarget('/p', 'https://example.com/a/b/')).toBe(join('/p', 'b'))
  })

  it('tells a login problem from the rest', () => {
    expect(classify('fatal: Authentication failed for https://x', 'https://x').code).toBe('auth')
    expect(classify("fatal: could not read Username for 'https://x': terminal prompts disabled").code).toBe('auth')
    expect(classify('fatal: unable to access: Could not resolve host: x').code).toBe('network')
  })

  it('will not clone into a folder that has files', async () => {
    writeFileSync(join(dir, 'x'), 'x')
    const e = await refusal(cloneInto(systemTransport('git'), 'https://example.com/a.git', dir))
    expect(e.code).toBe('exists')
    expect(existsSync(join(dir, '.git'))).toBe(false)
  })
})

describe('logins', () => {
  // A stand-in for the system's encryption: reversible, and plainly not the clear text.
  const cipher = (available = true) => ({
    available: () => available,
    encrypt: (t: string) => Buffer.from([...Buffer.from(t)].map((b) => b ^ 0x5a)),
    decrypt: (d: Buffer) => Buffer.from([...d].map((b) => b ^ 0x5a)).toString(),
  })

  it('keeps a login by host, encrypted on disk when asked', async () => {
    const { Logins } = await import('../../src/main/logins')
    const login = { username: 'ann', password: 'token-1' }
    const a = new Logins(dir, cipher())
    expect(a.set('https://git.example.com/team/notes.git', login, true)).toBe(true)
    expect(readFileSync(join(dir, 'logins.json'), 'utf8')).not.toContain('token-1')
    // Another repository of the host, another start of folio.
    expect(new Logins(dir, cipher()).get('https://git.example.com/me/other.git')).toEqual(login)
    expect(new Logins(dir, cipher()).get('https://example.org/x.git')).toBeUndefined()
    a.forget('https://git.example.com/')
    expect(new Logins(dir, cipher()).get('https://git.example.com/team/notes.git')).toBeUndefined()
  })

  it('without the system encryption: for the session only', async () => {
    const { Logins } = await import('../../src/main/logins')
    const a = new Logins(dir, cipher(false))
    expect(a.set('https://git.example.com/x.git', { username: 'ann', password: 'token-1' }, true)).toBe(false)
    expect(a.get('https://git.example.com/x.git')?.password).toBe('token-1')
    expect(readFileSync(join(dir, 'logins.json'), 'utf8')).not.toContain('token-1')
    expect(new Logins(dir, cipher(false)).get('https://git.example.com/x.git')).toBeUndefined()
  })
})

describe('line endings (core.autocrlf)', () => {
  it('a CRLF checkout of LF commits is unchanged; a real change is committed with LF', async () => {
    const a = join(dir, 'a.md')
    writeFileSync(a, '# A\n\none\n')
    await startHistory(dir, me, 'Start')
    // As Git for Windows checks it out.
    writeFileSync(a, '# A\r\n\r\none\r\n')
    const { changedFiles, stored } = await import('../../src/main/git')
    expect(await changedFiles(dir)).toEqual([])
    expect(await commitFile(dir, a, 'Nothing', me)).toBeNull()
    writeFileSync(a, '# A\r\n\r\ntwo\r\n')
    expect(await changedFiles(dir)).toEqual([a])
    await commitFile(dir, a, 'Two', me)
    expect(sh(dir, 'show', 'HEAD:a.md')).toBe('# A\n\ntwo')
    // A file that keeps CRs in its commits keeps them; binary files are left alone.
    expect(stored(Buffer.from('x\r\n'), Buffer.from('y\r\n')).toString()).toBe('x\r\n')
    expect(stored(Buffer.from([0, 13, 10]), null)).toEqual(Buffer.from([0, 13, 10]))
  })
})

describe('history for a commit graph', () => {
  it("a file's versions get parents among themselves, through commits that left it alone", async () => {
    const { historyOf, rewriteParents } = await import('../../src/main/git')
    const a = join(dir, 'a.md')
    writeFileSync(a, 'one\n')
    await startHistory(dir, me, 'Start')
    await createBranch(dir, 'side')
    writeFileSync(a, 'one\nside\n')
    await commitFile(dir, a, 'Side edit', me)
    writeFileSync(join(dir, 'b.md'), 'other\n')
    await commitFile(dir, join(dir, 'b.md'), 'Other file', me)
    await switchBranch(dir, 'main')
    writeFileSync(join(dir, 'c.md'), 'c\n')
    await commitFile(dir, join(dir, 'c.md'), 'Not a.md', me)
    sh(dir, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.com', 'merge', '--no-edit', 'side')
    writeFileSync(a, 'one\nside\nmain\n')
    await commitFile(dir, a, 'Main edit', me)
    const versions = await historyOf(dir, a)
    const byMessage = new Map(versions.map((v) => [v.message, v]))
    expect(versions.map((v) => v.message)).toEqual(['Main edit', 'Side edit', 'Start'])
    // Main edit → (the merge, which left a.md alone) → (Not a.md →) Start down the first parents, and Side edit.
    expect(byMessage.get('Main edit')!.parents).toEqual([byMessage.get('Start')!.oid, byMessage.get('Side edit')!.oid])
    expect(byMessage.get('Side edit')!.parents).toEqual([byMessage.get('Start')!.oid])
    expect(byMessage.get('Start')!.parents).toEqual([])
    expect(rewriteParents('x', new Set(['z']), (o) => ({ x: ['y'], y: ['z'] })[o])).toEqual(['z'])
    expect(rewriteParents('m', new Set(['a', 'b']), (o) => ({ m: ['x', 'b'], x: ['a'], b: ['a'] })[o])).toEqual(['a', 'b'])
  })

  it('every commit of the repository: branches, remotes, tags; children above parents', async () => {
    const { repositoryHistory } = await import('../../src/main/git')
    writeFileSync(join(dir, 'a.md'), 'a\n')
    await startHistory(dir, me, 'Start')
    sh(dir, 'tag', 'v1')
    await createBranch(dir, 'side')
    writeFileSync(join(dir, 'a.md'), 'b\n')
    await commitFile(dir, join(dir, 'a.md'), 'On side', me)
    await switchBranch(dir, 'main')
    writeFileSync(join(dir, 'c.md'), 'c\n')
    await commitFile(dir, join(dir, 'c.md'), 'On main', me)
    const all = await repositoryHistory(dir)
    expect(all.map((v) => v.message).sort()).toEqual(['On main', 'On side', 'Start'])
    expect(all.at(-1)!.message).toBe('Start')
    expect(all.at(-1)!.refs).toEqual(['tag: v1'])
    expect(all.find((v) => v.message === 'On main')!.refs).toEqual(['HEAD -> main'])
    expect(all.find((v) => v.message === 'On side')!.refs).toEqual(['side'])
    const index = new Map(all.map((v, i) => [v.oid, i]))
    for (const v of all) for (const p of v.parents) expect(index.get(p)!).toBeGreaterThan(index.get(v.oid)!)
  })
})

describe('history after merges', () => {
  it('lists each version once, though a merge leads to it on two paths', async () => {
    const { historyOf } = await import('../../src/main/git')
    const a = join(dir, 'a.md')
    writeFileSync(a, '1\n2\n3\n')
    await startHistory(dir, me, 'Start')
    writeFileSync(a, '1\n2 shared\n3\n')
    await commitFile(dir, a, 'Shared', me)
    await createBranch(dir, 'side')
    writeFileSync(a, '1 side\n2 shared\n3\n')
    await commitFile(dir, a, 'Side', me)
    await switchBranch(dir, 'main')
    writeFileSync(a, '1\n2 shared\n3 main\n')
    await commitFile(dir, a, 'Main', me)
    sh(dir, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.com', 'merge', '--no-edit', 'side')
    const oids = (await historyOf(dir, a)).map((v) => v.oid)
    expect(new Set(oids).size).toBe(oids.length)
    expect(oids).toHaveLength(5)
  })
})
