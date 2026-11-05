import { describe, expect, it } from 'vitest'
import { Awake, commandMarks, type Blocker } from '../../src/main/awake'

function blocker() {
  const started = new Map<number, string>()
  let next = 1
  const b: Blocker & { started: Map<number, string> } = {
    started,
    start: (type) => (started.set(next, type), next++),
    stop: (id) => void started.delete(id),
    isStarted: (id) => started.has(id),
  }
  return b
}

describe('awake: the system kept from sleeping', () => {
  it('on until off; the display too when asked', () => {
    const b = blocker()
    const a = new Awake(b)
    expect(a.set('on').holding).toBe(true)
    expect([...b.started.values()]).toEqual(['prevent-app-suspension'])
    a.setDisplay(true)
    expect([...b.started.values()]).toEqual(['prevent-display-sleep'])
    expect(a.set('off').holding).toBe(false)
    expect(b.started.size).toBe(0)
  })

  it('for a while: off once the time is up', () => {
    let now = 0
    const a = new Awake(blocker(), { now: () => now })
    expect(a.set('until', { minutes: 60 })).toMatchObject({ how: 'until', until: 3_600_000, holding: true })
    now = 3_600_001
    expect(a.set('until', { until: 1 })).toMatchObject({ how: 'off', holding: false })
  })

  it('while a command runs in a console, and a minute after', () => {
    let now = 0
    const a = new Awake(blocker(), { now: () => now, grace: 60_000 })
    expect(a.set('busy').holding).toBe(false)
    a.busy(1)
    expect(a.state.holding).toBe(true)
    now = 10_000
    a.busy(0)
    expect(a.state.holding).toBe(true)
    now = 80_000
    a.busy(0)
    expect(a.state.holding).toBe(false)
    expect(a.state.how).toBe('busy')
  })

  it('a listener that throws (a window gone) stops neither keeping awake nor letting go', () => {
    const b = blocker()
    const a = new Awake(b)
    a.onChange(() => {
      throw new TypeError('Object has been destroyed')
    })
    expect(a.set('busy').holding).toBe(false)
    a.busy(1)
    expect(b.started.size).toBe(1)
    a.release()
    expect(b.started.size).toBe(0)
  })

  it('reads the shell integration’s marks', () => {
    expect(commandMarks('$ \x1b]133;C\x07output\x1b]133;D;0\x07\x1b]133;A\x07')).toEqual(['start', 'end', 'end'])
    expect(commandMarks('plain')).toEqual([])
  })
})
