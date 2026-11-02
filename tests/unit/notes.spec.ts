import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dailyName, dayOf, fillTemplate, formatDate, neighbourDaily, templatesIn } from '../../src/main/notes'

const at = new Date(2026, 10, 2, 9, 5, 7)

describe('templates', () => {
  it('dates in formats', () => {
    expect(formatDate(at, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-11-02 09:05:07')
    expect(formatDate(at, 'D.M.YY')).toBe('2.11.26')
  })

  it('fields filled; an unknown one stays', () => {
    expect(fillTemplate('# {{title}}\n\n{{date}} {{time}}, {{date:DD.MM.YYYY}}, {{ time : HH }} {{other}}', { title: 'Plan', now: at })).toBe('# Plan\n\n2026-11-02 09:05, 02.11.2026, 09 {{other}}')
  })

  it('the templates of a folder, by name; none without the folder', () => {
    const d = mkdtempSync(join(tmpdir(), 'folio-tpl-'))
    writeFileSync(join(d, 'Meeting.md'), '')
    writeFileSync(join(d, 'Daily.md'), '')
    writeFileSync(join(d, 'image.png'), '')
    expect(templatesIn(d).map((t) => t.name)).toEqual(['Daily', 'Meeting'])
    expect(templatesIn(join(d, 'none'))).toEqual([])
  })
})

describe('daily notes', () => {
  it('a day’s name, and the day back from a name', () => {
    expect(dailyName(at)).toBe('2026-11-02.md')
    expect(dayOf('/x/2026-11-02.md')?.getDate()).toBe(2)
    expect(dayOf('/x/Plan.md')).toBeNull()
  })

  it('the nearest daily note before and after a day, skipping the days without one', () => {
    const d = mkdtempSync(join(tmpdir(), 'folio-daily-'))
    mkdirSync(d, { recursive: true })
    for (const n of ['2026-10-28.md', '2026-11-02.md', '2026-11-09.md', 'notes.md']) writeFileSync(join(d, n), '')
    expect(neighbourDaily(d, at, -1)).toBe('2026-10-28.md')
    expect(neighbourDaily(d, at, 1)).toBe('2026-11-09.md')
    expect(neighbourDaily(d, new Date(2026, 9, 1), -1)).toBeNull()
  })
})
