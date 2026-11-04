import { describe, expect, it } from 'vitest'
import { formatByName, isMedia, opensInFolio } from '../../src/main/formats'
import { kindOf } from '../../src/main/tree'
import { bytes, duration } from '../../src/renderer/mediaView'

describe('pictures, video and sound', () => {
  it('known by their names; shown in folio, listed as media', () => {
    expect(formatByName('a/photo.JPG')).toBe('image')
    expect(formatByName('clip.webm')).toBe('video')
    expect(formatByName('song.flac')).toBe('audio')
    expect(formatByName('logo.svg')).toBe('svg')
    // A draw.io drawing saved as SVG stays a drawing.
    expect(formatByName('arch.drawio.svg')).toBe('drawio')
    for (const name of ['photo.png', 'clip.mp4', 'song.mp3', 'logo.svg']) {
      expect(opensInFolio(name)).toBe(true)
      expect(kindOf(name)).toBe('media')
    }
    expect(isMedia('image')).toBe(true)
    expect(isMedia('svg')).toBe(false)
    // What Chromium does not decode stays the system's.
    expect(opensInFolio('scan.tiff')).toBe(false)
    expect(opensInFolio('photo.heic')).toBe(false)
  })

  it('sizes and lengths as people read them', () => {
    expect(bytes(512, 'en')).toBe('512 B')
    expect(bytes(8500, 'en')).toBe('8.3 KB')
    expect(bytes(3 * 1024 * 1024, 'ru')).toBe('3 МБ')
    expect(duration(2)).toBe('0:02')
    expect(duration(125.4)).toBe('2:05')
    expect(duration(3725)).toBe('1:02:05')
  })
})
