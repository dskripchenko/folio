import { describe, expect, it } from 'vitest'
import { BUILD_FOLDERS, excluded } from '../../src/main/watcher'

describe('watcher: build folders left out', () => {
  it('leaves out what is inside them, not the folder itself', () => {
    expect(excluded(['dist', 'a.js'], BUILD_FOLDERS)).toBe(true)
    expect(excluded(['packages', 'x', 'node', 'coverage', 'lcov.info'], BUILD_FOLDERS)).toBe(true)
    expect(excluded(['dist'], BUILD_FOLDERS)).toBe(false)
    expect(excluded(['src', 'build.ts'], BUILD_FOLDERS)).toBe(false)
    expect(excluded(['docs', 'out.md'], BUILD_FOLDERS)).toBe(false)
  })
  it('a project’s own list: names and paths from the top', () => {
    expect(excluded(['src', 'gen', 'a.ts'], ['src/gen'])).toBe(true)
    expect(excluded(['lib', 'src', 'gen', 'a.ts'], ['src/gen'])).toBe(false)
    expect(excluded(['dist', 'a.js'], ['src/gen'])).toBe(false)
  })
})
