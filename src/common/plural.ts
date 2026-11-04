/** A number in its form: `forms` as the language's plural rules order them (one, few, many / other), `{n}` the number. */
export function plural(n: number, forms: readonly string[], lang: string): string {
  const rule = new Intl.PluralRules(lang).select(n)
  const order = forms.length >= 3 ? ['one', 'few', 'many'] : ['one', 'other']
  const i = order.indexOf(rule)
  const form = forms[i >= 0 ? i : forms.length - 1] ?? forms[0] ?? ''
  return form.replace('{n}', n.toLocaleString(lang))
}
