import { describe, expect, it } from 'vitest'
import { consoleEvents } from '../../src/main/consoleEvents'

describe('console events: the shell’s marks and a program asking for attention', () => {
  it('reads a command, its start and end with the code', () => {
    expect(consoleEvents('\x1b]633;E;npm test\\x3b echo ok\x07\x1b]133;C\x07out\x1b]133;D;1\x07\x1b]133;A\x07$ ')).toEqual([
      { kind: 'command', text: 'npm test; echo ok' },
      { kind: 'start' },
      { kind: 'end', code: 1 },
      { kind: 'prompt' },
    ])
    expect(consoleEvents('\x1b]133;D\x1b\\')).toEqual([{ kind: 'end', code: null }])
  })

  it('a message (OSC 9, 777) or a lone bell; a progress bar and a terminator are not', () => {
    expect(consoleEvents('\x1b]9;Claude is waiting for your input\x07')).toEqual([{ kind: 'notify', text: 'Claude is waiting for your input' }])
    expect(consoleEvents('\x1b]777;notify;Claude;Done\x07')).toEqual([{ kind: 'notify', text: 'Claude: Done' }])
    expect(consoleEvents('\x1b]9;4;1;50\x07')).toEqual([])
    expect(consoleEvents('\x1b]7;file://host/tmp\x07text')).toEqual([])
    expect(consoleEvents('ding\x07')).toEqual([{ kind: 'bell' }])
    expect(consoleEvents('plain')).toEqual([])
  })
})
