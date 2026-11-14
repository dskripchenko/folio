import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CAPABILITIES, presencePath, removePresence, writePresence } from '../../src/main/presence'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('presence', () => {
  it('lives in the runtime folder, or where the environment says', () => {
    expect(presencePath({ FOLIO_PRESENCE: '/x/p.json' }, '/tmp')).toBe('/x/p.json')
    expect(presencePath({ XDG_RUNTIME_DIR: '/run/user/1000' }, '/tmp')).toBe(join('/run/user/1000', 'folio-presence.json'))
    expect(presencePath({}, '/tmp')).toBe(join('/tmp', 'folio-presence.json'))
  })

  it('is written while folio runs and removed only by the folio that wrote it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-presence-'))
    dirs.push(dir)
    const path = join(dir, 'p.json')
    writePresence(path, { pid: 10, version: '1.0.0', launch: ['/opt/folio'], capabilities: CAPABILITIES })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ pid: 10, launch: ['/opt/folio'], capabilities: ['open', 'line', 'project', 'review'] })
    const read = (p: string) => readFileSync(p, 'utf8')
    removePresence(path, 11, read)
    expect(existsSync(path)).toBe(true)
    removePresence(path, 10, read)
    expect(existsSync(path)).toBe(false)
    writeFileSync(path, 'not json')
    removePresence(path, 10, read)
    expect(existsSync(path)).toBe(true)
  })
})
