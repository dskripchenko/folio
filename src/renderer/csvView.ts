/**
 * A CSV or TSV file as a table: its first row the header (kept in view), a
 * click on a column sorting by it (up, down, as written), a thousand rows at a
 * time for a big file. The source is edited in the code editor.
 */

export interface TableText {
  more: string
  rows: readonly string[]
}

const PAGE = 1000

/** The separator a file uses: of `,`, `;`, a tab and `|`, the one its first lines have alike and most of. */
export function guessDelimiter(text: string, name = ''): string {
  if (/\.tsv$/i.test(name)) return '\t'
  const lines = splitLines(text.slice(0, 64 * 1024)).slice(0, 10)
  let best = ','
  let bestScore = 0
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => countOutsideQuotes(l, d)).filter((_, i, a) => i < a.length)
    if (counts.length === 0 || counts[0] === 0) continue
    // Lines with the same count as the first: the separator a table keeps.
    const alike = counts.filter((c) => c === counts[0]).length
    const score = alike * 1000 + counts[0]!
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l !== '')
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === d && !quoted) n++
  }
  return n
}

/** RFC 4180: fields in quotes may hold the separator, line breaks and `""` for a quote. */
export function parseCsv(text: string, d: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === d) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Numbers by value, the rest as people sort words; empty cells last. */
function compare(a: string, b: string): number {
  if (a === '' || b === '') return a === b ? 0 : a === '' ? 1 : -1
  const x = Number(a.replace(/\s/g, '').replace(',', '.'))
  const y = Number(b.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y
  return collator.compare(a, b)
}

function plural(n: number, forms: TableText['rows'], lang: string): string {
  const rule = new Intl.PluralRules(lang).select(n)
  const form = forms.length === 3 ? (rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2]) : n === 1 ? forms[0] : forms[1]
  return `${n.toLocaleString(lang)} ${form}`
}

export function csvView(o: { text: string; name: string; t: TableText; lang: string; info?: (rows: number, cols: number) => void }): HTMLElement {
  const box = document.createElement('div')
  box.className = 'csv-view'
  box.dataset.testid = 'csv-view'
  const rows = parseCsv(o.text, guessDelimiter(o.text, o.name))
  const header = rows[0] ?? []
  const body = rows.slice(1)
  const cols = Math.max(header.length, ...body.slice(0, 2000).map((r) => r.length))
  o.info?.(body.length, cols)

  const table = document.createElement('table')
  table.className = 'csv-table'
  const thead = document.createElement('thead')
  const hr = document.createElement('tr')
  const corner = document.createElement('th')
  corner.className = 'csv-n'
  hr.append(corner)
  /** The column sorted by and how: 1 up, -1 down. */
  let sort: { col: number; dir: 1 | -1 } | null = null
  const headCells: HTMLElement[] = []
  for (let c = 0; c < cols; c++) {
    const th = document.createElement('th')
    th.textContent = header[c] ?? ''
    th.title = header[c] ?? ''
    th.dataset.col = String(c)
    th.addEventListener('click', () => {
      // Up, down, then as written.
      sort = sort?.col !== c ? { col: c, dir: 1 } : sort.dir === 1 ? { col: c, dir: -1 } : null
      headCells.forEach((h, k) => (h.dataset.sort = sort?.col === k ? (sort.dir === 1 ? 'up' : 'down') : ''))
      order = sort ? [...indices].sort((a, b) => sort!.dir * compare(body[a]![sort!.col] ?? '', body[b]![sort!.col] ?? '') || a - b) : indices
      shown = 0
      tbody.replaceChildren()
      more()
    })
    headCells.push(th)
    hr.append(th)
  }
  thead.append(hr)
  const tbody = document.createElement('tbody')
  table.append(thead, tbody)
  const indices = body.map((_, i) => i)
  let order = indices
  let shown = 0
  const moreButton = document.createElement('button')
  moreButton.type = 'button'
  moreButton.className = 'csv-more'
  moreButton.dataset.testid = 'csv-more'
  const more = () => {
    const end = Math.min(order.length, shown + PAGE)
    const frag = document.createDocumentFragment()
    for (let k = shown; k < end; k++) {
      const i = order[k]!
      const tr = document.createElement('tr')
      const n = document.createElement('td')
      n.className = 'csv-n'
      n.textContent = String(i + 1)
      tr.append(n)
      const r = body[i]!
      for (let c = 0; c < cols; c++) {
        const td = document.createElement('td')
        const v = r[c] ?? ''
        td.textContent = v
        if (v.length > 40) td.title = v
        tr.append(td)
      }
      frag.append(tr)
    }
    tbody.append(frag)
    shown = end
    moreButton.hidden = shown >= order.length
    moreButton.textContent = o.t.more.replace('{n}', plural(Math.min(PAGE, order.length - shown), o.t.rows, o.lang))
  }
  moreButton.addEventListener('click', more)
  more()
  box.append(table, moreButton)
  return box
}
