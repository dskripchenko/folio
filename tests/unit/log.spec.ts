import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Log, dayOf, logDays } from '../../src/main/log'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-log-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const at = (s: string) => () => new Date(s)

describe('log: a file a day, kept for days', () => {
  it('writes JSON lines to the day’s file once flushed', () => {
    const log = new Log(dir, { every: 0, now: at('2026-11-05T10:00:00') })
    log.info('app', 'started', { version: '1.11.0' })
    log.error('git', 'failed')
    expect(readdirSync(dir)).toEqual([])
    log.flush()
    const lines = readFileSync(join(dir, 'folio-2026-11-05.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toMatchObject([
      { level: 'info', area: 'app', msg: 'started', data: { version: '1.11.0' }, proc: 'main' },
      { level: 'error', area: 'git', msg: 'failed' },
    ])
  })

  it('removes the files of days past those kept', () => {
    for (const d of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-04', '2026-11-05']) writeFileSync(join(dir, `folio-${d}.log`), 'x\n')
    writeFileSync(join(dir, 'folio-2026-10-31.1.log'), 'x\n')
    writeFileSync(join(dir, 'notes.txt'), 'kept')
    new Log(dir, { every: 0, days: 5, now: at('2026-11-05T10:00:00') })
    expect(readdirSync(dir).sort()).toEqual(['folio-2026-11-01.log', 'folio-2026-11-04.log', 'folio-2026-11-05.log', 'notes.txt'])
  })

  it('goes on in the next part past the size', () => {
    const log = new Log(dir, { every: 0, maxBytes: 100, now: at('2026-11-05T10:00:00') })
    for (let i = 0; i < 5; i++) {
      log.info('x', 'a line long enough to fill the part quickly')
      log.flush()
    }
    const names = readdirSync(dir).sort()
    expect(names[0]).toBe('folio-2026-11-05.1.log')
    expect(names).toContain('folio-2026-11-05.log')
    expect(statSync(join(dir, 'folio-2026-11-05.log')).size).toBeLessThan(250)
  })

  it('drops debug first, then counts what it could not keep', () => {
    const log = new Log(dir, { every: 0, maxPending: 2, now: at('2026-11-05T10:00:00') })
    log.debug('x', 'd')
    log.info('x', 'a')
    log.info('x', 'b')
    log.info('x', 'c')
    log.flush()
    const lines = readFileSync(join(dir, 'folio-2026-11-05.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l.msg)).toEqual(['a', 'b', 'lines dropped'])
    expect(lines[2].data).toEqual({ n: 1 })
  })

  it('removes old crash dumps with the days', () => {
    const crashes = join(dir, 'crashes')
    mkdirSync(join(crashes, 'completed'), { recursive: true })
    writeFileSync(join(crashes, 'completed', 'old.dmp'), 'x')
    writeFileSync(join(crashes, 'completed', 'new.dmp'), 'x')
    const old = new Date('2026-10-20T00:00:00').getTime() / 1000
    utimesSync(join(crashes, 'completed', 'old.dmp'), old, old)
    new Log(join(dir, 'logs'), { every: 0, now: at('2026-11-05T10:00:00'), alsoPrune: [crashes] })
    expect(readdirSync(join(crashes, 'completed'))).toEqual(['new.dmp'])
  })

  it('keeps days within 1–30, five by default', () => {
    expect(logDays(undefined)).toBe(5)
    expect(logDays(0)).toBe(1)
    expect(logDays(90)).toBe(30)
    expect(dayOf(new Date('2026-01-02T03:00:00'))).toBe('2026-01-02')
  })
})

describe('log: how the last run ended', () => {
  it('crashed without a quit after its start; clean with one; parts newest first', () => {
    const log = new Log(dir, { every: 0, now: at('2026-11-05T10:00:00') })
    expect(log.lastRun().ended).toBe('unknown')
    writeFileSync(join(dir, 'folio-2026-11-05.log'), JSON.stringify({ ts: 't1', level: 'info', proc: 'main', area: 'app', msg: 'start' }) + '\n')
    expect(log.lastRun()).toEqual({ ended: 'crashed', at: 't1' })
    writeFileSync(join(dir, 'folio-2026-11-05.1.log'), JSON.stringify({ ts: 't2', level: 'info', proc: 'main', area: 'app', msg: 'quit' }) + '\n')
    expect(log.files().map((f) => f.split('/').pop())).toEqual(['folio-2026-11-05.1.log', 'folio-2026-11-05.log'])
    expect(log.lastRun()).toEqual({ ended: 'clean', at: 't2' })
  })
})
