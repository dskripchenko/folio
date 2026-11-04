import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blameOf, historyBlame, parsePorcelain } from '../../src/main/blame'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-blame-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

let systemGit = true
try {
  execFileSync('git', ['--version'])
} catch {
  systemGit = false
}

const commit = (who: string, when: number, msg: string) =>
  execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${who.toLowerCase()}@example.com`, 'commit', '-qam', msg], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: `${when} +0000`, GIT_COMMITTER_DATE: `${when} +0000` },
  })

describe('who changed each line', () => {
  it.skipIf(!systemGit)('from the history (no system git) as git blame tells it', async () => {
    const file = join(dir, 'a.txt')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(file, 'one\ntwo\nthree\n')
    execFileSync('git', ['add', '.'], { cwd: dir })
    commit('Ann', 1_700_000_000, 'first')
    writeFileSync(file, 'one\nTWO\nthree\nfour\n')
    commit('Bob', 1_700_100_000, 'second')
    writeFileSync(file, 'zero\none\nTWO\nthree\nfour\n')
    const mine = await historyBlame(dir, file)
    const theirs = await blameOf(dir, file, 'git')
    const who = (l: { oid: string | null; author: string }) => (l.oid ? l.author : '-')
    expect(mine.map(who)).toEqual(['-', 'Ann', 'Bob', 'Ann', 'Bob'])
    expect(theirs.map(who)).toEqual(mine.map(who))
    expect(theirs[2]).toMatchObject({ author: 'Bob', email: 'bob@example.com', time: 1_700_100_000, summary: 'second' })
  })

  it('reads porcelain output, a commit named once and its lines after', () => {
    const oid = 'a'.repeat(40)
    const text = `${oid} 1 1 2\nauthor Ann\nauthor-mail <ann@example.com>\nauthor-time 100\nsummary first\nfilename a\n\tone\n${oid} 2 2\n\ttwo\n${'0'.repeat(40)} 3 3 1\nauthor Not Committed Yet\n\tthree\n`
    const lines = parsePorcelain(text)
    expect(lines.map((l) => l.author)).toEqual(['Ann', 'Ann', ''])
    expect(lines[2]!.oid).toBeNull()
  })
})
