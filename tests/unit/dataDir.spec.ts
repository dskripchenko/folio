import { describe, expect, it } from 'vitest'
import { dataDir, type DataDirInput } from '../../src/main/dataDir'

const base: DataDirInput = { env: {}, platform: 'linux', execPath: '/opt/folio/folio', packaged: true, cwd: '/work' }

describe('dataDir: settings live beside the program', () => {
  it('takes FOLIO_DATA when given, relative to the working directory', () => {
    expect(dataDir({ ...base, env: { FOLIO_DATA: 'data' } })).toBe('/work/data')
    expect(dataDir({ ...base, env: { FOLIO_DATA: '/tmp/f' } })).toBe('/tmp/f')
  })

  it('keeps a development run in the working directory', () => {
    expect(dataDir({ ...base, packaged: false })).toBe('/work/.folio-data')
  })

  it('puts them beside an AppImage, not inside its mount', () => {
    expect(dataDir({ ...base, execPath: '/tmp/.mount_folioX/folio', env: { APPIMAGE: '/home/ann/Apps/folio.AppImage' } })).toBe('/home/ann/Apps/folio-data')
  })

  it('puts them beside the .app bundle on macOS', () => {
    expect(dataDir({ ...base, platform: 'darwin', execPath: '/Users/ann/Apps/folio.app/Contents/MacOS/folio' })).toBe('/Users/ann/Apps/folio-data')
  })

  it('puts them beside the executable on Windows, or the folder a portable build was started from', () => {
    expect(dataDir({ ...base, platform: 'win32', execPath: 'D:\\Tools\\folio\\folio.exe' })).toBe('D:\\Tools\\folio\\folio-data')
    expect(dataDir({ ...base, platform: 'win32', execPath: 'C:\\Temp\\xyz\\folio.exe', env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Tools\\folio' } })).toBe('D:\\Tools\\folio\\folio-data')
  })
})
