import { describe, expect, it } from 'vitest'
import { parseProblems } from '../../src/renderer/problems'

const brief = (out: string) => parseProblems(out).map((p) => `${p.severity} ${p.file}:${p.line}:${p.column} ${p.message}`)

describe('problems in a task’s output', () => {
  it('tsc, gcc/clang, go, ruff, mypy, pytest', () => {
    expect(brief('src/a.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.')).toEqual(["error src/a.ts:3:7 Type 'string' is not assignable to type 'number'. (TS2322)"])
    expect(brief('main.c:4:12: warning: unused variable \'x\' [-Wunused-variable]')).toEqual(["warning main.c:4:12 unused variable 'x' [-Wunused-variable]"])
    expect(brief('./cmd/main.go:10:2: undefined: foo')).toEqual(['error ./cmd/main.go:10:2 undefined: foo'])
    expect(brief('app/x.py:5:1: F401 [*] `os` imported but unused')).toEqual(['error app/x.py:5:1 F401 [*] `os` imported but unused'])
    expect(brief('app/x.py:7: error: Incompatible return value  [return-value]')).toEqual(['error app/x.py:7:1 Incompatible return value  [return-value]'])
    expect(brief('tests/test_a.py:12: AssertionError')).toEqual(['error tests/test_a.py:12:1 AssertionError'])
  })

  it('eslint’s stylish blocks, rustc, psalm, colours and repeats left out', () => {
    const eslint = '\n/repo/src/a.js\n  3:7   error    \'x\' is defined but never used  no-unused-vars\n  9:1   warning  Unexpected console statement    no-console\n\n✖ 2 problems\n'
    expect(brief(eslint)).toEqual(["error /repo/src/a.js:3:7 'x' is defined but never used (no-unused-vars)", 'warning /repo/src/a.js:9:1 Unexpected console statement (no-console)'])
    const rust = 'error[E0425]: cannot find value `y` in this scope\n --> src/main.rs:3:13\n  |\n3 |     let x = y;\n'
    expect(brief(rust)).toEqual(['error src/main.rs:3:13 cannot find value `y` in this scope (E0425)'])
    expect(brief('ERROR: UndefinedVariable - src/A.php:12:9 - Cannot find referenced variable $x')).toEqual(['error src/A.php:12:9 Cannot find referenced variable $x'])
    expect(brief('\x1b[31msrc/b.ts(1,1): error TS1: x\x1b[0m\nsrc/b.ts(1,1): error TS1: x')).toEqual(['error src/b.ts:1:1 x (TS1)'])
    expect(brief('see https://example.com:443/x.html:12 for more\nnothing here: 3')).toEqual([])
  })
})
