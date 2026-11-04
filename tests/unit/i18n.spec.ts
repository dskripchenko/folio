import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BUILT_IN, chooseLanguage, languageOf, overBase, plural } from '../../src/common/i18n'
import { Languages } from '../../src/main/i18n'

/** Every leaf of a dictionary: its path and value. */
function leaves(v: unknown, path = ''): [string, unknown][] {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k))
  return [[path, v]]
}
const placeholders = (v: unknown) => [...new Set((Array.isArray(v) ? v.join(' ') : String(v)).match(/\{[a-z]+\}/gi) ?? [])].sort()

describe('the built-in languages', () => {
  const en = new Map(leaves(BUILT_IN.en))
  for (const [code, dictionary] of Object.entries(BUILT_IN).filter(([c]) => c !== 'en')) {
    it(`${code}: every English text translated, of the same kind, with the same {placeholders}, nothing more`, () => {
      const it = new Map(leaves(dictionary))
      const missing = [...en.keys()].filter((k) => !it.has(k) && !k.startsWith('meta.'))
      const extra = [...it.keys()].filter((k) => !en.has(k))
      expect(missing).toEqual([])
      expect(extra).toEqual([])
      for (const [k, v] of en) {
        if (k.startsWith('meta.')) continue
        const w = it.get(k)
        expect(Array.isArray(w), k).toBe(Array.isArray(v))
        expect(placeholders(w), k).toEqual(placeholders(v))
      }
    })
  }
})

describe('a language over English', () => {
  it('its texts where it has them, English for the rest and for what is of another kind', () => {
    const base = { a: 'A', b: { c: 'C', d: ['one', 'many'] }, e: 'E' }
    expect(overBase(base, { a: 'А', b: { d: 'not forms' }, e: 42, x: 'extra' })).toEqual({ a: 'А', b: { c: 'C', d: ['one', 'many'] }, e: 'E' })
  })

  it('named in itself, with a code', () => {
    expect(languageOf({ meta: { code: 'de', name: 'Deutsch' } })).toEqual({ code: 'de', name: 'Deutsch' })
    expect(languageOf({ meta: { code: 'German', name: 'x' } })).toBeNull()
    expect(languageOf({})).toBeNull()
  })

  it('the one chosen, else the system’s (or its language without the region), else English', () => {
    expect(chooseLanguage('ru', 'en-US', ['en', 'ru'])).toBe('ru')
    expect(chooseLanguage(null, 'ru-RU', ['en', 'ru'])).toBe('ru')
    expect(chooseLanguage(null, 'pt_BR', ['en', 'pt-BR', 'pt'])).toBe('pt-BR')
    expect(chooseLanguage(null, 'de-AT', ['en', 'de'])).toBe('de')
    expect(chooseLanguage('xx', 'ja', ['en', 'ru'])).toBe('en')
  })

  it('numbers in their forms', () => {
    expect(plural(1, ['{n} file', '{n} files'], 'en')).toBe('1 file')
    expect(plural(5, ['{n} file', '{n} files'], 'en')).toBe('5 files')
    expect(['1', '3', '5', '21'].map((n) => plural(Number(n), ['{n} файл', '{n} файла', '{n} файлов'], 'ru'))).toEqual(['1 файл', '3 файла', '5 файлов', '21 файл'])
  })
})

describe('languages of one’s own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'folio-locales-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

  it('a file in the folder is a language: listed, chosen, English where it says nothing', () => {
    writeFileSync(join(dir, 'de.json'), JSON.stringify({ meta: { code: 'de', name: 'Deutsch' }, main: { newNote: 'Neue Notiz' } }))
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    const languages = new Languages(dir)
    expect(languages.list().map((l) => l.code)).toEqual(['en', 'ru', 'de'])
    expect(languages.pick(null, 'de-DE')).toBe('de')
    const d = languages.dictionary('de')
    expect(d.main.newNote).toBe('Neue Notiz')
    expect(d.main.open).toBe(BUILT_IN.en!.main.open)
  })
})
