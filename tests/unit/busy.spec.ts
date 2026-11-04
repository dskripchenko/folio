import { describe, expect, it } from 'vitest'
import { whileBusy } from '../../src/main/busy'

const fail = (code: string) => Object.assign(new Error(code), { code })

describe('whileBusy', () => {
  it('tries again on Windows while the file is held, then succeeds', () => {
    let n = 0
    expect(whileBusy(() => (++n < 3 ? (() => { throw fail('EPERM') })() : 'done'), { platform: 'win32' })).toBe('done')
    expect(n).toBe(3)
  })
  it('gives up after its time', () => {
    expect(() => whileBusy(() => { throw fail('EBUSY') }, { platform: 'win32', ms: 30 })).toThrow('EBUSY')
  })
  it('throws other errors, and every error off Windows, at once', () => {
    let n = 0
    expect(() => whileBusy(() => { n++; throw fail('ENOENT') }, { platform: 'win32' })).toThrow('ENOENT')
    expect(() => whileBusy(() => { n++; throw fail('EPERM') }, { platform: 'darwin' })).toThrow('EPERM')
    expect(n).toBe(2)
  })
})
