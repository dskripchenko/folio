import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatterFor, formatText } from '../../src/main/format'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-format-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

const settings = (s: object) => {
  mkdirSync(join(dir, '.folio'), { recursive: true })
  writeFileSync(join(dir, '.folio', 'settings.json'), JSON.stringify(s))
}

describe('formatting on save', () => {
  it('only when the project asks for it', async () => {
    expect(await formatText(dir, join(dir, 'a.ts'), 'x')).toBeNull()
  })

  it.skipIf(process.platform === 'win32')('a command of one’s own reads the text on stdin', async () => {
    settings({ formatOnSave: true, formatter: "tr 'a-z' 'A-Z'" })
    expect(await formatText(dir, join(dir, 'a.txt'), 'hello\n')).toBe('HELLO\n')
    settings({ formatOnSave: true, formatter: 'false' })
    expect(await formatText(dir, join(dir, 'a.txt'), 'hello\n')).toBeNull()
    // Gone before reading a big text: the broken pipe is not an error of folio's.
    expect(await formatText(dir, join(dir, 'a.txt'), 'hello\n'.repeat(200_000))).toBeNull()
  })

  it.skipIf(process.platform === 'win32')('the project’s own prettier for the files it formats; pint on a copy beside the file', async () => {
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
    const bin = join(dir, 'node_modules', '.bin', 'prettier')
    writeFileSync(bin, '#!/bin/sh\nsed "s/  */ /g"\n')
    chmodSync(bin, 0o755)
    expect(formatterFor(dir, join(dir, 'a.ts'))?.bin).toBe(bin)
    expect(formatterFor(dir, join(dir, 'a.php'))).toBeNull()
    settings({ formatOnSave: true })
    expect(await formatText(dir, join(dir, 'a.ts'), 'const  a  =  1\n')).toBe('const a = 1\n')
    mkdirSync(join(dir, 'vendor', 'bin'), { recursive: true })
    const pint = join(dir, 'vendor', 'bin', 'pint')
    writeFileSync(pint, '#!/bin/sh\nfor f; do case "$f" in -*) ;; *) sed -i.bak "s/array()/[]/" "$f"; rm -f "$f.bak";; esac; done\n')
    chmodSync(pint, 0o755)
    expect(await formatText(dir, join(dir, 'a.php'), '<?php $a = array();\n')).toBe('<?php $a = [];\n')
  })
})
