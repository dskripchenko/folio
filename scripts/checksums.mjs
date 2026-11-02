// A `.sha256` beside each archive in release/ (`<hex>  <name>`, as sha256sum writes it):
// what the updater and a person downloading by hand check the archive against.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'release'
const archives = readdirSync(dir).filter((n) => /^folio-.*\.(zip|AppImage)$/.test(n))
if (archives.length === 0) throw new Error(`no archives in ${dir}`)
for (const name of archives) {
  const hex = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')
  writeFileSync(join(dir, `${name}.sha256`), `${hex}  ${name}\n`)
  console.log(`${hex}  ${name}`)
}
