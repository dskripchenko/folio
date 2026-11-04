import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { readJson, writeJson } from './jsonFile'

/**
 * Updates (ADR-001, stage 8), as `portable upgrade` does them: the latest
 * release on GitHub, its archive for this system downloaded into
 * `folio-data/update/`, checked against the `.sha256` published beside it,
 * unpacked there — and put in the program's place when folio closes. No
 * service runs in the background; the check is once a day at start, and can
 * be turned off.
 *
 * What the checksum proves: the archive is the one the release names, whole.
 * It comes over TLS from the same release, so it does not prove who made the
 * release — the build's Sigstore attestation does (`gh attestation verify`).
 */

export const RELEASES = 'https://api.github.com/repos/dskripchenko/folio/releases/latest'

/** The archive of a version for a system, as the release names it (electron-builder.yml). */
export function assetFor(version: string, platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `folio-${version}-mac-${arch}.zip`
  if (platform === 'win32' && arch === 'x64') return `folio-${version}-win-x64.zip`
  if (platform === 'linux' && arch === 'x64') return `folio-${version}-linux-x64.AppImage`
  return null
}

const parts = (v: string): number[] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Whether `candidate` is a later release than `current`; pre-releases and odd tags never are. */
export function newer(candidate: string, current: string): boolean {
  const a = parts(candidate)
  const b = parts(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

export interface Release {
  version: string
  name: string
  url: string
  shaUrl: string
}

/** From GitHub's release JSON: the later version's archive for this system and its checksum, or null. */
export function pickRelease(json: unknown, current: string, platform: NodeJS.Platform, arch: string): Release | null {
  if (!json || typeof json !== 'object') return null
  const r = json as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown }
  if (typeof r.tag_name !== 'string' || r.draft === true || r.prerelease === true || !Array.isArray(r.assets)) return null
  const version = r.tag_name.replace(/^v/, '')
  if (!newer(version, current)) return null
  const name = assetFor(version, platform, arch)
  if (!name) return null
  const url = (n: string): string | null => {
    const a = (r.assets as { name?: unknown; browser_download_url?: unknown }[]).find((x) => x.name === n)
    return a && typeof a.browser_download_url === 'string' && /^https?:\/\//.test(a.browser_download_url) ? a.browser_download_url : null
  }
  const asset = url(name)
  const sha = url(`${name}.sha256`)
  return asset && sha ? { version, name, url: asset, shaUrl: sha } : null
}

/** The digest in a `.sha256` file (`<hex>  <name>`, or the hex alone). */
export function shaOf(text: string): string | null {
  const m = /^\s*([0-9a-fA-F]{64})\b/.exec(text)
  return m ? m[1]!.toLowerCase() : null
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'latest' }
  | { status: 'downloading'; version: string; received?: number; total?: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; error: string }

interface Staged {
  version: string
  /** The unpacked program: a `.app`, a folder, or an AppImage. */
  path: string
}

export interface UpdaterOptions {
  /** `folio-data/update`. */
  dir: string
  current: string
  platform: NodeJS.Platform
  arch: string
  /** The running program: its executable, and the AppImage it came from on Linux. */
  execPath: string
  appImage?: string
  /** Electron's `net.fetch`: the system's proxy settings. */
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
  /** How long an answer may take to begin, and the download may go without a byte (ms). */
  timeouts?: { answer: number; idle: number }
  releases?: string
  onState: (state: UpdateState) => void
}

/** Where the program is, to be replaced: the `.app`, the AppImage, or the folder of the `.exe`. */
export function installedAt(platform: NodeJS.Platform, execPath: string, appImage?: string): string | null {
  if (platform === 'darwin') return /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)?.[1] ?? null
  if (platform === 'linux') return appImage ?? null
  return dirname(execPath)
}

export class Updater {
  private state: UpdateState = { status: 'idle' }
  private restart = false

  constructor(private readonly o: UpdaterOptions) {
    mkdirSync(o.dir, { recursive: true })
  }

  get current(): UpdateState {
    return this.state
  }

  private set(state: UpdateState): void {
    this.state = state
    this.o.onState(state)
  }

  private staged(): Staged | null {
    const s = readJson<Partial<Staged>>(join(this.o.dir, 'ready.json'), {})
    return typeof s.version === 'string' && typeof s.path === 'string' && existsSync(s.path) ? (s as Staged) : null
  }

  /**
   * At start: what an earlier update left is cleared — the old program put
   * aside, a download cut short, a version already running. One still waiting
   * is ready again.
   */
  tidy(): void {
    const staged = this.staged()
    const keep = staged && newer(staged.version, this.o.current) ? staged : null
    for (const name of readdirSync(this.o.dir)) {
      if (name === 'state.json' || (keep && (name === 'ready.json' || join(this.o.dir, name) === dirname(keep.path) || join(this.o.dir, name) === keep.path))) continue
      rmSync(join(this.o.dir, name), { recursive: true, force: true })
    }
    if (keep) this.set({ status: 'ready', version: keep.version })
  }

  /** Whether a day has passed since the last check. */
  due(now = Date.now()): boolean {
    const at = readJson<{ checkedAt?: number }>(join(this.o.dir, 'state.json'), {}).checkedAt
    return typeof at !== 'number' || now - at > 24 * 60 * 60 * 1000 || at > now
  }

  /** The latest release: downloaded, checked and unpacked when it is newer. */
  async check(): Promise<UpdateState> {
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.state
    if (this.state.status === 'ready') return this.state
    this.set({ status: 'checking' })
    writeJson(join(this.o.dir, 'state.json'), { checkedAt: Date.now() })
    try {
      const res = await this.fetchWithin(this.o.releases ?? RELEASES, (this.o.timeouts ?? { answer: 30_000 }).answer, 'GitHub')
      if (!res.ok) throw new Error(`the releases answered ${res.status}`)
      const release = pickRelease(await res.json(), this.o.current, this.o.platform, this.o.arch)
      if (!release) {
        this.set({ status: 'latest' })
        return this.state
      }
      this.set({ status: 'downloading', version: release.version })
      await this.download(release)
      this.set({ status: 'ready', version: release.version })
    } catch (error) {
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
    return this.state
  }

  /** A request that must start answering in time: a network that swallows it is not waited on for ever. */
  private async fetchWithin(url: string, ms: number, what: string, abort = new AbortController()): Promise<Response> {
    const timer = setTimeout(() => abort.abort(new Error(`${what} did not answer in ${Math.round(ms / 1000)} s`)), ms)
    try {
      return await this.o.fetch(url, { signal: abort.signal })
    } catch (e) {
      throw abort.signal.aborted && abort.signal.reason instanceof Error ? abort.signal.reason : e
    } finally {
      clearTimeout(timer)
    }
  }

  private async download(release: Release): Promise<void> {
    const { answer, idle } = this.o.timeouts ?? { answer: 30_000, idle: 60_000 }
    const shaRes = await this.fetchWithin(release.shaUrl, answer, 'the checksum')
    if (!shaRes.ok) throw new Error(`the checksum answered ${shaRes.status}`)
    const expected = shaOf(await shaRes.text())
    if (!expected) throw new Error('the checksum file holds no SHA-256')
    const file = join(this.o.dir, `${release.name}.part`)
    const abort = new AbortController()
    const res = await this.fetchWithin(release.url, answer, 'the download', abort)
    if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`)
    const total = Number(res.headers.get('content-length')) || undefined
    const hash = createHash('sha256')
    const source = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
    // How far it is, said a few times a second; a download that stops getting bytes is given up.
    let received = 0
    let said = 0
    let stalled: ReturnType<typeof setTimeout> | null = null
    const watch = () => {
      if (stalled) clearTimeout(stalled)
      stalled = setTimeout(() => source.destroy(new Error(`the download stopped for ${Math.round(idle / 1000)} s`)), idle)
    }
    watch()
    source.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      received += chunk.length
      watch()
      const now = Date.now()
      if (now - said >= 250) {
        said = now
        this.set({ status: 'downloading', version: release.version, received, ...(total ? { total } : {}) })
      }
    })
    try {
      await pipeline(source, createWriteStream(file))
    } catch (e) {
      abort.abort()
      rmSync(file, { force: true })
      throw e
    } finally {
      if (stalled) clearTimeout(stalled)
    }
    if (hash.digest('hex') !== expected) {
      rmSync(file, { force: true })
      throw new Error('the download does not match its checksum')
    }
    const target = join(this.o.dir, release.version)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    const path = this.unpack(file, target)
    rmSync(file, { force: true })
    writeJson(join(this.o.dir, 'ready.json'), { version: release.version, path } satisfies Staged)
  }

  /** The archive unpacked with the system's own tools: `ditto` on macOS, `tar` on Windows; an AppImage is the program. */
  private unpack(file: string, target: string): string {
    const run = (cmd: string, args: string[]): void => {
      const r = spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true })
      if (r.status !== 0) throw new Error(`${cmd} could not unpack the update`)
    }
    if (this.o.platform === 'linux') {
      const path = join(target, 'folio.AppImage')
      renameSync(file, path)
      chmodSync(path, 0o755)
      return path
    }
    if (this.o.platform === 'darwin') {
      run('ditto', ['-x', '-k', file, target])
      const app = readdirSync(target).find((n) => n.endsWith('.app'))
      if (!app) throw new Error('the archive holds no .app')
      return join(target, app)
    }
    run('tar', ['-xf', file, '-C', target])
    if (!existsSync(join(target, 'folio.exe'))) throw new Error('the archive holds no folio.exe')
    return target
  }

  /** folio starts again once the update is in place. */
  restartAfter(): void {
    this.restart = true
  }

  /**
   * Leaving: the staged version takes the program's place. macOS and Linux
   * rename while running; Windows does not let a running `.exe` be replaced,
   * so a PowerShell started apart from folio waits for it to exit and copies it over (the
   * `folio-data` beside it untouched). Returns whether folio should start
   * again by `app.relaunch` (Windows starts it from that script).
   */
  apply(pid: number): { relaunch: false } | { relaunch: true; execPath?: string } {
    const staged = this.state.status === 'ready' ? this.staged() : null
    const place = installedAt(this.o.platform, this.o.execPath, this.o.appImage)
    if (!staged || !place) return { relaunch: false }
    try {
      if (this.o.platform === 'darwin') {
        const aside = join(this.o.dir, `old-${Date.now()}.app`)
        renameSync(place, aside)
        try {
          renameSync(staged.path, place)
        } catch (error) {
          renameSync(aside, place)
          throw error
        }
        rmSync(join(this.o.dir, 'ready.json'), { force: true })
        return this.restart ? { relaunch: true } : { relaunch: false }
      }
      if (this.o.platform === 'linux') {
        renameSync(staged.path, place)
        rmSync(join(this.o.dir, 'ready.json'), { force: true })
        return this.restart ? { relaunch: true, execPath: place } : { relaunch: false }
      }
      const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
      const script = [
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.WaitForExit(60000) | Out-Null }`,
        `robocopy ${q(staged.path)} ${q(place)} /MIR /XD ${q(join(place, 'folio-data'))} /R:10 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null`,
        `if ($LASTEXITCODE -lt 8) { Remove-Item -LiteralPath ${q(join(this.o.dir, 'ready.json'))} -Force -ErrorAction SilentlyContinue }`,
        ...(this.restart ? [`Start-Process -FilePath ${q(join(place, 'folio.exe'))}`] : []),
      ].join('; ')
      // Started through WMI: outside folio's process tree and job object, which a terminal or a CI
      // runner closes with folio, killing a plain detached child before it copies anything.
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const create = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ${encoded}' } | Out-Null`
      spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', create], { stdio: 'ignore', windowsHide: true, timeout: 20_000 })
    } catch {
      // Left as it was: the next start runs the version it had.
    }
    return { relaunch: false }
  }
}
