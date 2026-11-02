import { describe, expect, it } from 'vitest'
import { shellEnv, shellOf } from '../../src/main/pty'

describe('the shell of a console', () => {
  it('starts from the user’s environment, not the one folio was started with', () => {
    const env = shellEnv({
      HOME: '/home/u',
      SHELL: '/bin/zsh',
      LANG: 'ru_RU.UTF-8',
      npm_config_prefix: '/opt/node',
      npm_lifecycle_event: 'start',
      PNPM_SCRIPT_SRC_DIR: '/x',
      INIT_CWD: '/x',
      NODE_OPTIONS: '--max-old-space-size=4096',
      ELECTRON_RUN_AS_NODE: '1',
      PATH: '/x/node_modules/.bin:/usr/lib/node_modules/pnpm/dist/node-gyp-bin:/usr/local/bin:/usr/bin',
    })
    expect(env).toEqual({ HOME: '/home/u', SHELL: '/bin/zsh', LANG: 'ru_RU.UTF-8', PATH: '/usr/local/bin:/usr/bin' })
  })

  it('a login shell where the shell has one; PowerShell on Windows', () => {
    expect(shellOf({ SHELL: '/bin/zsh' }, 'darwin')).toEqual({ file: '/bin/zsh', args: ['-l'] })
    expect(shellOf({}, 'win32').file).toMatch(/powershell/i)
  })
})
