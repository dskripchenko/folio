import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Consent } from '../../src/main/consent'
import { documentOfUrl, fileOfUrl, filesFromArgv, launchRequest, openDocument } from '../../src/main/documents'
import { isInside, resolveInside } from '../../src/main/paths'
import { Roots } from '../../src/main/roots'
import { Session } from '../../src/main/session'
import { Buffers, hashText, newBufferId } from '../../src/main/buffers'
import { Workspace } from '../../src/main/workspace'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-unit-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('paths: nothing leaves a root', () => {
  it('tells inside from outside, `..file` names included', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b/c/d.md')).toBe(true)
    expect(isInside('/a/b', '/a/b/..notes.md')).toBe(true)
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(isInside('/a/b', '/a')).toBe(false)
  })

  it('resolves a file of the root, refuses `..` and a link pointing out', () => {
    const root = join(dir, 'root')
    mkdirSync(join(root, 'sub'), { recursive: true })
    writeFileSync(join(root, 'sub', 'a.md'), 'a')
    writeFileSync(join(dir, 'secret.txt'), 's')
    // Windows lets only some users make symbolic links: there the check is skipped.
    let linked = true
    try {
      symlinkSync(join(dir, 'secret.txt'), join(root, 'leak.txt'))
    } catch {
      linked = false
    }
    expect(resolveInside(root, 'sub/a.md')).toMatch(/sub[\\/]a\.md$/)
    expect(resolveInside(root, '../secret.txt')).toBeNull()
    expect(resolveInside(root, 'sub/../../secret.txt')).toBeNull()
    if (linked) expect(resolveInside(root, 'leak.txt')).toBeNull()
    expect(resolveInside(root, 'missing.md')).toBeNull()
  })
})

describe('workspace: Shared and the projects', () => {
  it('keeps Shared in folio-data by default and projects where they are', () => {
    const ws = new Workspace(join(dir, 'data'))
    expect(ws.shared()).toBe(join(dir, 'data', 'library'))
    const p = ws.addProject(join(dir, 'proj'))
    expect(ws.addProject(join(dir, 'proj')).id).toBe(p.id)
    ws.updateProject(p.id, { pinned: true, group: 'Work' })
    // Read back from the file.
    const again = new Workspace(join(dir, 'data'))
    expect(again.projects()).toEqual([{ id: p.id, name: 'proj', path: join(dir, 'proj'), pinned: true, group: 'Work', kind: 'notes' }])
    again.removeProject(p.id)
    expect(new Workspace(join(dir, 'data')).projects()).toEqual([])
  })

  it('says whose a file is: the innermost project, else Shared, else nobody', () => {
    const ws = new Workspace(join(dir, 'data'))
    const outer = ws.addProject(join(dir, 'p'))
    const inner = ws.addProject(join(dir, 'p', 'inner'))
    expect(ws.ownerOf(join(dir, 'p', 'inner', 'x.md'))).toEqual({ kind: 'project', project: inner })
    expect(ws.ownerOf(join(dir, 'p', 'y.md'))).toEqual({ kind: 'project', project: outer })
    expect(ws.ownerOf(join(ws.shared(), 'z.md'))).toEqual({ kind: 'shared' })
    expect(ws.ownerOf(join(dir, 'elsewhere.md'))).toBeNull()
  })
})

describe('documents', () => {
  it('opens a file with its root and base, and maps a link back to a document', () => {
    const ws = new Workspace(join(dir, 'data'))
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, 'my docs'), { recursive: true })
    writeFileSync(join(proj, 'my docs', 'a.md'), '# A')
    writeFileSync(join(proj, 'b.md'), '# B')
    ws.addProject(proj, 'Project')
    const roots = new Roots()
    const doc = openDocument(join(proj, 'my docs', 'a.md'), ws, roots)
    expect(doc).toMatchObject({ name: 'a.md', text: '# A', owner: 'project', project: 'Project' })
    expect(doc.base).toBe(`folio://app/r/${Roots.idOf(proj)}/my%20docs/`)
    expect(fileOfUrl(`${doc.base}../b.md`.replace('my%20docs/../', ''), roots)).toMatch(/b\.md$/)
    // The kit drops `.md` from relative links.
    expect(documentOfUrl(`folio://app/r/${Roots.idOf(proj)}/b`, roots)).toMatch(/b\.md$/)
    expect(documentOfUrl('folio://app/r/0000000000000000/b', roots)).toBeNull()
  })

  it('takes the files of a command line, after the app', () => {
    const files = (...names: string[]) => (p: string) => names.some((n) => p === resolve(n))
    expect(filesFromArgv(['/x/electron', '.', 'a.md', '--flag'], '/w', files('/w/a.md'))).toEqual([resolve('/w', 'a.md')])
    expect(filesFromArgv(['/opt/folio', '/d/b.md'], '/w', files('/d/b.md'))).toEqual([resolve('/d/b.md')])
    // A test runner's `-r loader.js` and the like are not documents; nor is what does not exist.
    expect(filesFromArgv(['/x/electron.exe', '-r', '/pw/loader.js', '--inspect=0', '.', '/d/b.md', 'gone.md'], '/w', files('/pw/loader.js', '/d/b.md'))).toEqual([resolve('/d/b.md')])
  })

  it('reads a line after a file, a project and a review from a command line', () => {
    const files = (p: string) => p === resolve('/w/a.ts')
    const dirs = (p: string) => p === resolve('/w/app') || p === resolve('/repo')
    expect(launchRequest(['/opt/folio', 'a.ts:12', 'a.ts:3:7', 'gone.ts:4', '--project', 'app', '--review', '/repo'], '/w', files, dirs)).toEqual({
      files: [
        { path: resolve('/w/a.ts'), line: 12 },
        { path: resolve('/w/a.ts'), line: 3 },
      ],
      project: resolve('/w/app'),
      review: resolve('/repo'),
    })
    // A folder that is not there is passed over, and its value is not taken for a file.
    expect(launchRequest(['/opt/folio', '--review', 'a.ts', '--project'], '/w', files, dirs)).toEqual({ files: [], project: null, review: null })
  })
})

describe('consent and session', () => {
  it('allows a file, or a folder with everything inside, and remembers it', () => {
    const c = new Consent(dir)
    c.allow('file', '/docs/a.md')
    c.allow('folder', '/proj')
    const again = new Consent(dir)
    expect(again.allows('/docs/a.md')).toBe(true)
    expect(again.allows('/docs/b.md')).toBe(false)
    expect(again.allows('/proj/deep/c.md')).toBe(true)
    again.revoke('/proj')
    expect(new Consent(dir).allows('/proj/deep/c.md')).toBe(false)
  })

  it('keeps the tabs — files, buffers — and the active one', () => {
    new Session(dir).set([{ path: '/a.md', buffer: null }, { path: null, buffer: 'b1' }], 1)
    const s = new Session(dir)
    expect(s.tabs()).toEqual([{ path: '/a.md', buffer: null, color: null, group: null }, { path: null, buffer: 'b1', color: null, group: null }])
    expect(s.active()).toBe(1)
  })

  it('keeps the tabs’ colours and groups; a group no tab names, or a colour that is none, is let go', () => {
    const work = { id: 'g1', name: 'Work', color: 'teal' as const, collapsed: true }
    new Session(dir).set(
      [
        { path: '/a.md', buffer: null, color: 'red', group: 'g1' },
        { path: '/b.md', buffer: null, color: 'magenta' as never, group: 'gone' },
      ],
      0,
      [work],
    )
    const s = new Session(dir)
    expect(s.tabs()).toEqual([
      { path: '/a.md', buffer: null, color: 'red', group: 'g1' },
      { path: '/b.md', buffer: null, color: null, group: null },
    ])
    expect(s.groups()).toEqual([work])
  })

  it('reads the session of the first version: files and the active path', () => {
    mkdirSync(join(dir, 'session'), { recursive: true })
    writeFileSync(join(dir, 'session', 'session.json'), JSON.stringify({ version: 1, documents: [{ path: '/a.md' }, { path: '/b.md' }], active: '/b.md' }))
    const s = new Session(dir)
    expect(s.tabs()).toEqual([{ path: '/a.md', buffer: null }, { path: '/b.md', buffer: null }])
    expect(s.active()).toBe(1)
  })
})

describe('buffers: what is typed and not saved', () => {
  it('keeps a note and an edit, newest first, and forgets them when told', async () => {
    const b = new Buffers(dir)
    const note = newBufferId()
    const edit = newBufferId()
    b.write({ id: note, path: null, text: '# Idea', baseline: null, mode: 'visual', scroll: 0, updatedAt: '' })
    await new Promise((r) => setTimeout(r, 5))
    b.write({ id: edit, path: '/a.md', text: 'changed', baseline: hashText('original'), mode: 'source', scroll: 120, updatedAt: '' })
    const again = new Buffers(dir)
    expect(again.all().map((x) => x.id)).toEqual([edit, note])
    expect(again.get(note)).toMatchObject({ path: null, text: '# Idea' })
    expect(again.get(edit)).toMatchObject({ path: '/a.md', baseline: hashText('original'), mode: 'source', scroll: 120 })
    again.remove(note)
    expect(new Buffers(dir).get(note)).toBeNull()
  })

  it('refuses ids that are not its own (no path out of the folder)', () => {
    const b = new Buffers(dir)
    expect(() => b.write({ id: '../../x', path: null, text: '', baseline: null, mode: 'visual', scroll: 0, updatedAt: '' })).toThrow()
    expect(b.get('../../x')).toBeNull()
  })
})

describe('a project of notes or of code', () => {
  it('guessed by its top: a project file, or a repository with no notes; changed by hand; a code project never commits on save', () => {
    const notes = join(dir, 'notes')
    const code = join(dir, 'code')
    const repo = join(dir, 'repo')
    for (const d of [notes, code, join(repo, '.git')]) mkdirSync(d, { recursive: true })
    writeFileSync(join(notes, 'Ideas.md'), '# Ideas\n')
    writeFileSync(join(code, 'go.mod'), 'module x\n')
    writeFileSync(join(repo, 'README.md'), '# repo\n')
    const ws = new Workspace(join(dir, 'data'))
    expect(ws.addProject(notes).kind).toBe('notes')
    const c = ws.addProject(code)
    expect(c.kind).toBe('code')
    expect(ws.addProject(repo).kind).toBe('code')
    ws.updateProject(c.id, { autoCommit: true })
    expect(ws.autoCommits(join(code, 'main.go'))).toBe(false)
    ws.updateProject(c.id, { kind: 'notes' })
    expect(ws.autoCommits(join(code, 'main.go'))).toBe(true)
  })
})
