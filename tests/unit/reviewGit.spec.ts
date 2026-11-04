import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hunksOf, splitLines } from '../../src/common/hunks'
import { ReviewGit, parseNameStatus, parseNumstat, parseWorktrees } from '../../src/main/review/git'
import { WorktreeGit } from '../../src/main/review/worktreeGit'

const g = new ReviewGit('git')
let dir = ''
let repo = ''

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const write = (path: string, text: string) => writeFileSync(join(repo, path), text)
const read = (path: string) => readFileSync(join(repo, path), 'utf8')
function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'folio-review-')))
  repo = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['core.autocrlf', 'false']]) git(repo, 'config', k!, v!)
  write('a.txt', 'a\nb\nc\nd\ne\nf\n')
  write('old.txt', 'kept\nlines\n')
  write('gone.txt', 'bye\n')
  commitAll(repo, 'first')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('parsing git', () => {
  it('names and numbers, renames among them', () => {
    expect(parseNameStatus('M\0a.txt\0R087\0old.txt\0new.txt\0')).toEqual([{ path: 'a.txt', status: 'modified' }, { path: 'new.txt', oldPath: 'old.txt', status: 'renamed' }])
    const stats = parseNumstat('2\t1\ta.txt\0-\t-\tpic.png\0' + '1\t0\t\0old.txt\0new.txt\0')
    expect(stats.get('a.txt')).toEqual({ add: 2, del: 1, binary: false })
    expect(stats.get('pic.png')).toEqual({ add: 0, del: 0, binary: true })
    expect(stats.get('new.txt')).toEqual({ add: 1, del: 0, binary: false })
  })
  it('worktrees, a bare one left out', () => {
    const out = 'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/.claude/worktrees/x\nHEAD def\nbranch refs/heads/agent-x\nlocked\n\nworktree /b\nbare\n'
    expect(parseWorktrees(out)).toEqual([
      { path: '/r', head: 'abc', branch: 'main', locked: false, prunable: false },
      { path: '/r/.claude/worktrees/x', head: 'def', branch: 'agent-x', locked: true, prunable: false },
    ])
  })
})

describe('sets of changes', () => {
  it('the working copy: changed, deleted, staged rename, new and binary files', async () => {
    write('a.txt', 'a\nB\nc\nd\nf\n')
    rmSync(join(repo, 'gone.txt'))
    git(repo, 'mv', 'old.txt', 'new.txt')
    write('fresh.md', '# Fresh\n\ntext\n')
    writeFileSync(join(repo, 'pic.bin'), Buffer.from([0, 1, 2, 0]))
    const set = await g.changeset({ kind: 'working', repo })
    expect(set.files.map((f) => [f.path, f.status, f.add, f.del, f.binary, !!f.untracked])).toEqual([
      ['a.txt', 'modified', 1, 2, false, false],
      ['fresh.md', 'added', 3, 0, false, true],
      ['gone.txt', 'deleted', 0, 1, false, false],
      ['new.txt', 'renamed', 0, 0, false, false],
      ['pic.bin', 'added', 0, 0, true, true],
    ])
    expect(set.files.find((f) => f.path === 'new.txt')!.oldPath).toBe('old.txt')
    const texts = await g.texts(set, set.files[0]!)
    expect(texts).toEqual({ before: 'a\nb\nc\nd\ne\nf\n', after: 'a\nB\nc\nd\nf\n', index: 'a\nb\nc\nd\ne\nf\n' })
    expect(await g.texts(set, set.files[1]!)).toMatchObject({ before: null, after: '# Fresh\n\ntext\n' })
    expect(await g.texts(set, set.files[4]!)).toEqual({ before: null, after: null, binary: true })
  })

  it('a commit and a range of commits', async () => {
    write('a.txt', 'a\nb\nc\nd\ne\nf\ng\n')
    commitAll(repo, 'second')
    write('b.txt', 'new\n')
    commitAll(repo, 'third')
    const head = git(repo, 'rev-parse', 'HEAD').trim()
    const commit = await g.changeset({ kind: 'commit', repo, oid: head })
    expect(commit.files.map((f) => [f.path, f.status])).toEqual([['b.txt', 'added']])
    const range = await g.changeset({ kind: 'range', repo, from: 'HEAD~2', to: 'HEAD' })
    expect(range.files.map((f) => f.path)).toEqual(['a.txt', 'b.txt'])
    expect(await g.texts(range, range.files[0]!)).toEqual({ before: 'a\nb\nc\nd\ne\nf\n', after: 'a\nb\nc\nd\ne\nf\ng\n' })
    // The first commit, against nothing.
    const first = await g.changeset({ kind: 'commit', repo, oid: 'HEAD~2' })
    expect(first.files.map((f) => f.path)).toEqual(['a.txt', 'gone.txt', 'old.txt'])
  })
})

describe('the working copy’s actions', () => {
  const runOf = (before: string, after: string, n: number) => {
    const h = hunksOf(splitLines(before), splitLines(after))[n]!
    return { ...h, lines: { before: splitLines(before).slice(h.a, h.aEnd), after: splitLines(after).slice(h.b, h.bEnd) } }
  }
  const head = 'a\nb\nc\nd\ne\nf\n'
  const work = 'a\nB\nc\nd\nf\n'

  it('one run staged, taken out again; another thrown away', async () => {
    write('a.txt', work)
    await g.act(repo, 'stage', 'a.txt', runOf(head, work, 0))
    expect(git(repo, 'diff', '--cached', '--', 'a.txt')).toContain('+B')
    expect(git(repo, 'diff', '--cached', '--', 'a.txt')).not.toContain('-e')
    await g.act(repo, 'unstage', 'a.txt', runOf(head, work, 0))
    expect(git(repo, 'diff', '--cached', '--', 'a.txt')).toBe('')
    await g.act(repo, 'discard', 'a.txt', runOf(head, work, 1))
    expect(read('a.txt')).toBe('a\nB\nc\nd\ne\nf\n')
  })

  it('a run that changed meanwhile is refused', async () => {
    write('a.txt', work)
    const run = runOf(head, work, 0)
    write('a.txt', 'a\nX\nc\nd\nf\n')
    await expect(g.act(repo, 'stage', 'a.txt', run)).rejects.toThrow('stale')
  })

  it('whole files: staged, taken out, thrown away; a new one out of the index', async () => {
    write('a.txt', work)
    write('n.txt', 'n\n')
    await g.act(repo, 'stage', 'a.txt', null)
    await g.act(repo, 'stage', 'n.txt', null)
    expect(git(repo, 'diff', '--cached', '--name-only').split('\n').filter(Boolean)).toEqual(['a.txt', 'n.txt'])
    await g.act(repo, 'unstage', 'a.txt', null)
    await g.act(repo, 'discard', 'n.txt', null)
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')
    await g.act(repo, 'discard', 'a.txt', null)
    expect(read('a.txt')).toBe(head)
  })
})

describe('worktrees', () => {
  it('listed with where they stand; reviewed against the base; taken, merged, removed', async () => {
    const wt = join(dir, 'agent')
    git(repo, 'worktree', 'add', '-q', '-b', 'agent-x', wt)
    writeFileSync(join(wt, 'a.txt'), 'a\nb\nc\nd\ne\nf\nagent\n')
    commitAll(wt, 'agent work')
    writeFileSync(join(wt, 'note.md'), 'not committed\n')
    const list = await g.worktrees(repo, 'main')
    expect(list.map((w) => [w.main, w.branch, w.ahead, w.behind, w.changed])).toEqual([
      [true, 'main', 0, 0, 0],
      [false, 'agent-x', 1, 0, 1],
    ])
    expect(list[1]!.lastActivity).toBeGreaterThan(0)
    const set = await g.changeset({ kind: 'worktree', path: wt, base: 'main' })
    expect(set.files.map((f) => [f.path, f.status])).toEqual([['a.txt', 'modified'], ['note.md', 'added']])

    // Taken into the main copy without a commit.
    await g.takeChanges(repo, wt, 'main')
    expect(read('a.txt')).toBe('a\nb\nc\nd\ne\nf\nagent\n')
    expect(read('note.md')).toBe('not committed\n')
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1)
    // (A 3-way apply stages what it brings.)
    expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('a.txt')
    git(repo, 'reset', '-q', '--hard')
    rmSync(join(repo, 'note.md'))

    // Merged with a commit of its own.
    await g.mergeBranch(repo, 'agent-x')
    expect(read('a.txt')).toContain('agent')
    // Removed, its changes with it, and its branch.
    await expect(g.removeWorktree(repo, wt, false, null)).rejects.toThrow()
    await g.removeWorktree(repo, wt, true, 'agent-x')
    expect(existsSync(wt)).toBe(false)
    expect(git(repo, 'branch', '--list', 'agent-x')).toBe('')
  })
})

describe('since the last look', () => {
  it('nothing looked at: the working copy; then only what changed after the look, commits meanwhile too', async () => {
    write('a.txt', 'a\nB\nc\nd\ne\nf\n')
    expect((await g.since(repo, null)).files.map((f) => f.path)).toEqual(['a.txt'])
    const cp = await g.snapshot(repo)
    expect(cp.files).toEqual({ 'a.txt': 'a\nB\nc\nd\ne\nf\n' })
    expect((await g.since(repo, cp)).files).toEqual([])

    // An agent: one more edit to a.txt, a new file, and a commit of another file.
    write('a.txt', 'a\nB\nc\nD\ne\nf\n')
    write('new.md', 'x\n')
    write('gone.txt', 'changed\n')
    git(repo, 'commit', '-q', '-m', 'agent', '--', 'gone.txt')
    const set = await g.since(repo, cp)
    expect(set.files.map((f) => [f.path, f.status, f.add, f.del]).sort()).toEqual([
      ['a.txt', 'modified', 1, 1],
      ['gone.txt', 'modified', 1, 1],
      ['new.md', 'added', 1, 0],
    ])
    expect(set.files.every((f) => typeof f.mtime === 'number')).toBe(true)
    // The texts: as seen, and as now.
    expect(await g.sinceTexts(repo, cp, 'a.txt')).toEqual({ before: 'a\nB\nc\nd\ne\nf\n', after: 'a\nB\nc\nD\ne\nf\n' })
    expect(await g.sinceTexts(repo, cp, 'gone.txt')).toEqual({ before: 'bye\n', after: 'changed\n' })
  })
})

describe('a worktree opened as a project', () => {
  it('its changes, staged and committed, its history and a file at HEAD — through the system git', async () => {
    const wt = join(dir, 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'agent', wt)
    const w = new WorktreeGit('git')
    writeFileSync(join(wt, 'a.txt'), 'changed\n')
    writeFileSync(join(wt, 'n.txt'), 'n\n')
    expect(await w.changes(wt)).toEqual({ staged: [], unstaged: [{ path: 'a.txt', kind: 'modified' }, { path: 'n.txt', kind: 'untracked' }] })
    await w.stage(wt, ['a.txt', 'n.txt'])
    expect((await w.changes(wt)).staged).toEqual([{ path: 'a.txt', kind: 'modified' }, { path: 'n.txt', kind: 'added' }])
    await w.unstage(wt, ['n.txt'])
    expect((await w.changes(wt)).staged).toEqual([{ path: 'a.txt', kind: 'modified' }])
    const oid = await w.commit(wt, 'agent did it', { name: 'A', email: 'a@example.com' }, false)
    expect(oid).toMatch(/^[0-9a-f]{40}$/)
    expect((await w.branches(wt)).current).toBe('agent')
    const history = await w.history(wt, join(wt, 'a.txt'))
    expect(history.map((v) => v.message)).toEqual(['agent did it', 'first'])
    expect(history[0]!.refs).toContain('agent')
    expect(await w.headText(wt, join(wt, 'a.txt'))).toBe('changed\n')
    await w.discard(wt, 'n.txt')
    expect(existsSync(join(wt, 'n.txt'))).toBe(false)
  })
})

describe('a worktree inside the repository (.claude/worktrees)', () => {
  it('is not a change of the main copy', async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'inner', join(repo, '.claude', 'worktrees', 'inner'))
    const list = await g.worktrees(repo, 'main')
    expect(list.find((w) => w.main)!.changed).toBe(0)
    expect((await g.changeset({ kind: 'working', repo })).files).toEqual([])
    expect((await new WorktreeGit('git').changes(repo)).unstaged).toEqual([])
  })
})

