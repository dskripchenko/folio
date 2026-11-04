import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { amendLast, createTag, deleteBranch, deleteTag, lastMessage, renameBranch, revertCommit, stashApply, stashDrop, stashList, stashPush, tagsOf } from '../../src/main/gitOps'
import { branchOf, createBranch } from '../../src/main/git'

const author = { name: 'Test', email: 'test@example.com' }
const bin = 'git'
let dir = ''

async function commit(file: string, text: string, message: string): Promise<string> {
  writeFileSync(join(dir, file), text)
  await git.add({ fs, dir, filepath: file })
  return git.commit({ fs, dir, message, author })
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-gitops-'))
  await git.init({ fs, dir, defaultBranch: 'main' })
  await commit('a.txt', 'one\n', 'first')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('putting changes aside', () => {
  it('every change, new files too; listed; taken back, then dropped', async () => {
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    await stashPush(bin, dir, 'half done', author)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\n')
    expect(existsSync(join(dir, 'new.txt'))).toBe(false)
    const list = await stashList(bin, dir)
    expect(list.map((s) => [s.index, s.message])).toEqual([[0, 'half done']])
    await stashApply(bin, dir, 0, false)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('two\n')
    expect(existsSync(join(dir, 'new.txt'))).toBe(true)
    expect(await stashList(bin, dir)).toHaveLength(1)
    await stashDrop(bin, dir, 0)
    expect(await stashList(bin, dir)).toHaveLength(0)
  })

  it('nothing changed: nothing to put aside; no git: refused', async () => {
    await expect(stashPush(bin, dir, '', author)).rejects.toMatchObject({ code: 'nothing' })
    writeFileSync(join(dir, 'a.txt'), 'x\n')
    await expect(stashPush(null, dir, '', author)).rejects.toMatchObject({ code: 'no-git' })
    expect(await stashList(null, dir)).toEqual([])
  })
})

describe('commits', () => {
  it('the last one amended: its message, the staged change in it, no new commit', async () => {
    expect(await lastMessage(dir)).toBe('first')
    writeFileSync(join(dir, 'a.txt'), 'one more\n')
    await git.add({ fs, dir, filepath: 'a.txt' })
    await amendLast(dir, 'first, fixed', author)
    const log = await git.log({ fs, dir })
    expect(log).toHaveLength(1)
    expect(log[0]!.commit.message.trim()).toBe('first, fixed')
  })

  it('one undone by a new commit; a clean tree is asked first', async () => {
    const second = await commit('a.txt', 'two\n', 'second')
    await revertCommit(bin, dir, second, author)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\n')
    expect((await git.log({ fs, dir }))[0]!.commit.message).toMatch(/^Revert "second"/)
    writeFileSync(join(dir, 'a.txt'), 'dirty\n')
    await expect(revertCommit(bin, dir, second, author)).rejects.toMatchObject({ code: 'dirty' })
  })
})

describe('branches and tags', () => {
  it('a branch renamed (the one checked out too) and deleted, never the current one', async () => {
    await createBranch(dir, 'topic')
    expect(await branchOf(dir)).toBe('topic')
    await renameBranch(dir, 'topic', 'feature/x')
    expect(await branchOf(dir)).toBe('feature/x')
    await expect(deleteBranch(dir, 'feature/x')).rejects.toMatchObject({ code: 'current' })
    await expect(renameBranch(dir, 'feature/x', 'bad name')).rejects.toMatchObject({ code: 'invalid' })
    await git.checkout({ fs, dir, ref: 'main' })
    await deleteBranch(dir, 'feature/x')
    expect(await git.listBranches({ fs, dir })).toEqual(['main'])
  })

  it('tags: plain and annotated, listed, refused twice, deleted', async () => {
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    await createTag(dir, 'v1.0.0', head, '', author)
    await createTag(dir, 'v1.0.1', head, 'The first fix', author)
    expect(await tagsOf(dir)).toEqual(['v1.0.0', 'v1.0.1'])
    const annotated = await git.readTag({ fs, dir, oid: await git.resolveRef({ fs, dir, ref: 'refs/tags/v1.0.1' }) })
    expect(annotated.tag.message.trim()).toBe('The first fix')
    await expect(createTag(dir, 'v1.0.0', head, '', author)).rejects.toMatchObject({ code: 'exists' })
    await deleteTag(dir, 'v1.0.0')
    expect(await tagsOf(dir)).toEqual(['v1.0.1'])
  })
})
