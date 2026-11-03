import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changesOf, changesOfRows, commitStaged, discardFile, stageFiles, unstageFiles } from '../../src/main/changes'
import { startHistory } from '../../src/main/git'

const author = { name: 'T', email: 't@example.com' }
let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-changes-'))
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  writeFileSync(join(dir, 'b.txt'), 'two\n')
  await startHistory(dir, author, 'start')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('the changes of a repository', () => {
  it('reads the status matrix as staged and unstaged', () => {
    expect(
      changesOfRows([
        ['new-staged', 0, 2, 2],
        ['untracked', 0, 2, 0],
        ['mod-unstaged', 1, 2, 1],
        ['mod-staged', 1, 2, 2],
        ['mod-both', 1, 2, 3],
        ['del-unstaged', 1, 0, 1],
        ['del-staged', 1, 0, 0],
        ['clean', 1, 1, 1],
      ]),
    ).toEqual({
      staged: [
        { path: 'del-staged', kind: 'deleted' },
        { path: 'mod-both', kind: 'modified' },
        { path: 'mod-staged', kind: 'modified' },
        { path: 'new-staged', kind: 'added' },
      ],
      unstaged: [
        { path: 'del-unstaged', kind: 'deleted' },
        { path: 'mod-both', kind: 'modified' },
        { path: 'mod-unstaged', kind: 'modified' },
        { path: 'untracked', kind: 'untracked' },
      ],
    })
  })

  it('staged, unstaged, thrown away and committed; the system git agrees', async () => {
    writeFileSync(join(dir, 'a.txt'), 'one changed\n')
    unlinkSync(join(dir, 'b.txt'))
    writeFileSync(join(dir, 'c.txt'), 'three\n')
    expect(await changesOf(dir)).toEqual({
      staged: [],
      unstaged: [
        { path: 'a.txt', kind: 'modified' },
        { path: 'b.txt', kind: 'deleted' },
        { path: 'c.txt', kind: 'untracked' },
      ],
    })
    await stageFiles(dir, ['a.txt', 'b.txt', 'c.txt'])
    expect((await changesOf(dir)).staged.map((c) => `${c.kind}:${c.path}`)).toEqual(['modified:a.txt', 'deleted:b.txt', 'added:c.txt'])
    await unstageFiles(dir, ['c.txt', 'b.txt'])
    expect(await changesOf(dir)).toEqual({
      staged: [{ path: 'a.txt', kind: 'modified' }],
      unstaged: [
        { path: 'b.txt', kind: 'deleted' },
        { path: 'c.txt', kind: 'untracked' },
      ],
    })
    // Thrown away: the deleted file back, the untracked one gone.
    await discardFile(dir, 'b.txt')
    await discardFile(dir, 'c.txt')
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('two\n')
    expect(existsSync(join(dir, 'c.txt'))).toBe(false)
    // A staged file changed again, then thrown away: back to what is staged.
    writeFileSync(join(dir, 'a.txt'), 'one changed twice\n')
    await discardFile(dir, 'a.txt')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one changed\n')
    expect(await commitStaged(dir, 'Change a', author)).toMatch(/^[0-9a-f]{40}$/)
    expect(await changesOf(dir)).toEqual({ staged: [], unstaged: [] })
    expect(await commitStaged(dir, 'nothing', author)).toBeNull()
    let systemGit = true
    try {
      execFileSync('git', ['--version'])
    } catch {
      systemGit = false
    }
    if (systemGit) expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('')
  })

  it('a file in a folder: staged, changed again, thrown away back to what is staged', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true })
    writeFileSync(join(dir, 'src', 'deep', 'n.txt'), 'v1\n')
    await stageFiles(dir, ['src/deep/n.txt'])
    writeFileSync(join(dir, 'src', 'deep', 'n.txt'), 'v2\n')
    await discardFile(dir, 'src/deep/n.txt')
    expect(readFileSync(join(dir, 'src', 'deep', 'n.txt'), 'utf8')).toBe('v1\n')
  })
})
