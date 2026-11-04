/**
 * Languages of folio (ADR-005): a dictionary a language, English the base and
 * Russian the second, both built in; another language is a JSON file of the
 * same shape (in `folio-data/locales`) — what it leaves out is English.
 */
import en from '../locales/en.json'
import ru from '../locales/ru.json'

export type Dictionary = typeof en

/** The languages built in, by code. */
export const BUILT_IN: Readonly<Record<string, Dictionary>> = { en, ru }

export interface Language {
  code: string
  /** Its name in itself (Русский, Deutsch). */
  name: string
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * A translation over the base: every key of the base, the translation's value
 * where it has one of the same kind (a text for a text, a list of texts for
 * forms of a number, a section for a section); the rest the base's.
 */
export function overBase<T>(base: T, over: unknown): T {
  if (isObject(base)) {
    const from = isObject(over) ? over : {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(base)) out[k] = overBase(v, from[k])
    return out as T
  }
  if (Array.isArray(base)) return (Array.isArray(over) && over.length > 0 && over.every((x) => typeof x === 'string') ? over : base) as T
  if (typeof base === 'string') return (typeof over === 'string' && over !== '' ? over : base) as T
  return base
}

/** A dictionary's code and name, when it says them well enough to be listed. */
export function languageOf(dictionary: unknown): Language | null {
  if (!isObject(dictionary) || !isObject(dictionary.meta)) return null
  const { code, name } = dictionary.meta
  if (typeof code !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code) || typeof name !== 'string' || name.trim() === '') return null
  return { code, name: name.trim() }
}

/**
 * The language to use: the one chosen, else the system's (its exact code, then
 * its language without the region: pt-BR, then pt), else English.
 */
export function chooseLanguage(choice: string | null, system: string, available: readonly string[]): string {
  if (choice && available.includes(choice)) return choice
  const tag = system.replace('_', '-')
  if (available.includes(tag)) return tag
  const base = tag.split('-')[0]!.toLowerCase()
  return available.find((c) => c.toLowerCase() === base) ?? 'en'
}

export { plural } from './plural'
