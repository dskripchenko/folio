import { describe, expect, it } from 'vitest'
import { Flights, Kept } from '../../src/main/flight'

const later = <T>() => {
  let resolve!: (v: T) => void
  const p = new Promise<T>((r) => (resolve = r))
  return { p, resolve }
}

describe('flights: one at a time per key, the rest share the next', () => {
  it('runs one, queues one for everyone asking meanwhile', async () => {
    const f = new Flights<number>('t')
    let runs = 0
    const gates = [later<number>(), later<number>()]
    const work = () => gates[runs++]!.p
    const first = f.run('a', work)
    const asked = Array.from({ length: 10 }, () => f.run('a', work))
    expect(new Set(asked).size).toBe(1)
    expect(f.stats()).toEqual({ running: 1, queued: 1 })
    gates[0]!.resolve(1)
    expect(await first).toBe(1)
    gates[1]!.resolve(2)
    expect(await asked[0]).toBe(2)
    expect(runs).toBe(2)
    expect(f.stats()).toEqual({ running: 0, queued: 0 })
  })

  it('keys apart run apart; a failure does not stop the next', async () => {
    const f = new Flights<number>('t')
    const bad = f.run('a', () => Promise.reject(new Error('x')))
    const next = f.run('a', () => Promise.resolve(3))
    await expect(bad).rejects.toThrow('x')
    expect(await next).toBe(3)
    expect(await f.run('b', () => Promise.resolve(4))).toBe(4)
  })
})

describe('kept: read once, again after a change under it', () => {
  it('keeps until a change inside, around or at its folder', async () => {
    let reads = 0
    const k = new Kept<number>('k', async () => ++reads)
    expect(await k.get('/p/a')).toBe(1)
    expect(await k.get('/p/a')).toBe(1)
    k.changed('/p/b')
    expect(await k.get('/p/a')).toBe(1)
    k.changed('/p/a/sub')
    expect(await k.get('/p/a')).toBe(2)
    k.changed('/p')
    expect(await k.get('/p/a')).toBe(3)
  })

  it('does not keep what changed while it was read', async () => {
    const gate = later<number>()
    let reads = 0
    const k = new Kept<number>('k', () => (++reads === 1 ? gate.p : Promise.resolve(9)))
    const first = k.get('/p')
    k.changed('/p')
    gate.resolve(1)
    expect(await first).toBe(1)
    expect(await k.get('/p')).toBe(9)
  })
})
