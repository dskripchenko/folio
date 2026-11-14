import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findShell, shellPresencePath } from '../../src/main/shellLink'

const at = join('/tmp', 'shell-presence.json')
const input = (presence: object | null, over: object = {}) => ({
  env: {},
  platform: 'linux' as NodeJS.Platform,
  uid: 1000,
  tmp: '/tmp',
  read: (p: string) => {
    if (p === at && presence) return JSON.stringify(presence)
    throw new Error('ENOENT')
  },
  owner: () => 1000,
  alive: (pid: number) => pid === 7,
  ...over,
})
const good = { pid: 7, url: 'http://127.0.0.1:5123', token: 't', capabilities: ['open-tab', 'paste'] }

describe('the shell terminal', () => {
  it('is found by its presence file: the user’s own, of a live process, with a local address', () => {
    expect(findShell(input(good))).toEqual({ url: good.url, token: 't', capabilities: ['open-tab', 'paste'] })
    expect(findShell(input(null))).toBeNull()
    expect(findShell(input({ ...good, pid: 8 }))).toBeNull()
    expect(findShell(input(good, { owner: () => 0 }))).toBeNull()
    expect(findShell(input({ ...good, url: 'http://example.com:80' }))).toBeNull()
    expect(findShell(input({ ...good, token: 1 }))).toBeNull()
  })

  it('looks where the environment says, else in the runtime or temporary folder', () => {
    expect(shellPresencePath({ SHELL_PRESENCE: '/x.json' }, '/tmp')).toBe('/x.json')
    expect(shellPresencePath({ XDG_RUNTIME_DIR: '/run/user/1' }, '/tmp')).toBe(join('/run/user/1', 'shell-presence.json'))
    expect(shellPresencePath({}, '/tmp')).toBe(at)
  })
})
