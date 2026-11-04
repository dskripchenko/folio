import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILT_IN, chooseLanguage, languageOf, overBase, type Dictionary, type Language } from '../common/i18n'

/** The labels of folio's native menus and dialogs. */
export type Labels = Dictionary['main']

/**
 * The languages folio speaks (ADR-005): English and Russian built in, and
 * any `folio-data/locales/<code>.json` laid beside them — read again when
 * asked, so a file dropped there is listed without a restart.
 */
export class Languages {
  constructor(private readonly dir: string) {}

  /** The dictionaries of the folder, by their code (a broken file left out). */
  private own(): Map<string, unknown> {
    const out = new Map<string, unknown>()
    let names: string[]
    try {
      names = readdirSync(this.dir).filter((n) => n.endsWith('.json'))
    } catch {
      return out
    }
    for (const name of names) {
      try {
        const dictionary = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as unknown
        const lang = languageOf(dictionary)
        if (lang) out.set(lang.code, dictionary)
      } catch {
        // Not JSON: not a language.
      }
    }
    return out
  }

  /** Every language there is: the built-in ones, then the folder's (one of its own over a built-in of the same code). */
  list(): Language[] {
    const out = new Map<string, Language>()
    for (const d of Object.values(BUILT_IN)) out.set(d.meta.code, { code: d.meta.code, name: d.meta.name })
    for (const [code, d] of this.own()) out.set(code, languageOf(d) ?? { code, name: code })
    return [...out.values()]
  }

  /** The language to use: the one chosen, else the system's, else English. */
  pick(choice: string | null, system: string): string {
    return chooseLanguage(choice, system, this.list().map((l) => l.code))
  }

  /** A language's dictionary over English: the folder's own, else the built-in one. */
  dictionary(code: string): Dictionary {
    const own = this.own().get(code)
    const built = BUILT_IN[code]
    // A built-in language completed by the folder's file of it, if any.
    return overBase(overBase(BUILT_IN.en!, built), own)
  }
}
