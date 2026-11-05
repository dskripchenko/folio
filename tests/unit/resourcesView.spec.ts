import { describe, expect, it } from 'vitest'
import { chartPath, serviceName, shortBytes } from '../../src/renderer/resources'

describe('resources in the window', () => {
  it('shortens memory for the rail', () => {
    expect(shortBytes(511 * 1024 ** 2)).toBe('511M')
    expect(shortBytes(1.24 * 1024 ** 3)).toBe('1.2G')
    expect(shortBytes(13.4 * 1024 ** 3)).toBe('13G')
  })
  it('names a helper’s service', () => {
    expect(serviceName('network.mojom.NetworkService')).toBe('Network Service')
    expect(serviceName('')).toBe('')
  })
  it('draws memory over the last half hour', () => {
    expect(chartPath([], 100, 10, 1, 60, 60)).toBe('')
    expect(chartPath([{ at: 0, memory: 0 }, { at: 60, memory: 1 }], 100, 10, 1, 60, 60)).toBe('M0,10 L100,0')
  })
})
