/**
 * Tabs' colours and groups: a tab may have a colour of its own and belong to
 * a group (a name, a colour, folded or not); a group's tabs stand together in
 * the row.
 */
export const TAB_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'red', 'yellow', 'grey'] as const
export type TabColor = (typeof TAB_COLORS)[number]

export function isTabColor(v: unknown): v is TabColor {
  return typeof v === 'string' && (TAB_COLORS as readonly string[]).includes(v)
}

export interface GroupData {
  id: string
  name: string
  color: TabColor
  collapsed: boolean
}

/** A group as stored, or null when it is not one. */
export function groupOf(v: unknown): GroupData | null {
  if (!v || typeof v !== 'object') return null
  const g = v as Record<string, unknown>
  if (typeof g.id !== 'string' || g.id === '' || !isTabColor(g.color)) return null
  return { id: g.id, name: typeof g.name === 'string' ? g.name.slice(0, 80) : '', color: g.color, collapsed: g.collapsed === true }
}

interface Grouped {
  group: string | null
}

/** The row with each group's tabs together, where its first tab is; the rest in their order. */
export function keepTogether<T extends Grouped>(row: readonly T[]): T[] {
  const out: T[] = []
  const placed = new Set<string>()
  for (const item of row) {
    if (item.group === null) out.push(item)
    else if (!placed.has(item.group)) {
      placed.add(item.group)
      out.push(...row.filter((x) => x.group === item.group))
    }
  }
  return out
}

/**
 * The group of a tab just moved to `index`: the one it was dropped inside (between
 * two of its tabs); its own while it stays beside it (or is all of it); else none.
 */
export function groupAt<T extends Grouped>(row: readonly T[], index: number): string | null {
  const own = row[index]?.group ?? null
  const before = row[index - 1]?.group ?? null
  const after = row[index + 1]?.group ?? null
  if (before !== null && before === after) return before
  if (own === null) return null
  if (before === own || after === own) return own
  return row.some((x, i) => i !== index && x.group === own) ? null : own
}

/** A colour for a new group: the first no group has yet. */
export function freeColor(used: Iterable<TabColor>): TabColor {
  const taken = new Set(used)
  return TAB_COLORS.find((c) => !taken.has(c)) ?? TAB_COLORS[0]
}
