import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Consent } from '../../src/main/consent'
import { documentOfUrl, fileOfUrl, filesFromArgv, openDocument } from '../../src/main/documents'
import { isInside, resolveInside } from '../../src/main/paths'
import { Roots } from '../../src/main/roots'
import { Session } from '../../src/main/session'
import { Workspace } from '../../src/main/workspace'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-unit-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

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
    expect(again.projects()).toEqual([{ id: p.id, name: 'proj', path: join(dir, 'proj'), pinned: true, group: 'Work' }])
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
    expect(filesFromArgv(['/x/electron', '.', 'a.md', '--flag'], false, '/w')).toEqual([resolve('/w', 'a.md')])
    expect(filesFromArgv(['/opt/folio', '/d/b.md'], true, '/w')).toEqual([resolve('/d/b.md')])
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

  it('keeps the open documents and the active one', () => {
    new Session(dir).set(['/a.md', '/b.md'], '/b.md')
    // Kept as given: they are what the window reported.
    const s = new Session(dir)
    expect(s.documents()).toEqual(['/a.md', '/b.md'])
    expect(s.active()).toBe('/b.md')
  })
})
