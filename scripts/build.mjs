// Builds the main process, the preload and the window into dist/.
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist/renderer', { recursive: true })

const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'es2023' }

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron'] })
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] })
await build({ ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife' })
// The print page: documents laid out for a PDF in a hidden window (stage 7).
await build({ ...common, entryPoints: ['src/renderer/print.ts'], outfile: 'dist/renderer/print.js', platform: 'browser', format: 'iife' })
cpSync('src/renderer/index.html', 'dist/renderer/index.html')
cpSync('src/renderer/style.css', 'dist/renderer/style.css')
cpSync('src/renderer/print.html', 'dist/renderer/print.html')
cpSync('src/renderer/print.css', 'dist/renderer/print.css')
// embed's fat bundle, inside the app: every widget, nothing fetched at run time.
mkdirSync('dist/renderer/vendor', { recursive: true })
cpSync('node_modules/@dskripchenko/embed/dist/embed.bundle.js', 'dist/renderer/vendor/embed.bundle.js')
