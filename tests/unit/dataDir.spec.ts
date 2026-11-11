import { describe, expect, it } from 'vitest'
import { dataDir, translocated, type DataDirInput } from '../../src/main/dataDir'

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

describe('translocated: macOS ran a read-only copy', () => {
  it('tells the copy App Translocation started from the .app where it lies', () => {
    expect(translocated('darwin', '/private/var/folders/8b/x7w5/T/AppTranslocation/EAECE0AC-7E00-4EBA-9095-7196EFD53FA1/d/folio.app/Contents/MacOS/folio')).toBe(true)
    expect(translocated('darwin', '/Applications/folio.app/Contents/MacOS/folio')).toBe(false)
    expect(translocated('darwin', '/Users/ann/AppTranslocation/folio.app/Contents/MacOS/folio')).toBe(false)
    expect(translocated('linux', '/tmp/AppTranslocation/X/d/folio.app/Contents/MacOS/folio')).toBe(false)
  })
})
