// Builds the main process, the preload and the window into dist/.
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist/renderer', { recursive: true })

const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'es2023' }

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron', 'node-pty'], loader: { '.zsh': 'text', '.bash': 'text', '.ps1': 'text' } })
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] })
await build({ ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife' })
// The print page: documents laid out for a PDF in a hidden window (stage 7).
await build({ ...common, entryPoints: ['src/renderer/print.ts'], outfile: 'dist/renderer/print.js', platform: 'browser', format: 'iife' })
cpSync('src/renderer/index.html', 'dist/renderer/index.html')
cpSync('src/renderer/style.css', 'dist/renderer/style.css')
cpSync('src/renderer/print.html', 'dist/renderer/print.html')
cpSync('src/renderer/print.css', 'dist/renderer/print.css')
// The app's icon for the window and the Dock (build/icons, made by scripts/icons.mjs).
cpSync('build/icons/png/512.png', 'dist/icon.png')
// embed's fat bundle, inside the app: every widget, nothing fetched at run time.
mkdirSync('dist/renderer/vendor', { recursive: true })
cpSync('node_modules/@dskripchenko/embed/dist/embed.bundle.js', 'dist/renderer/vendor/embed.bundle.js')
// A math font (STIX Two Math, SIL Open Font License) for formulas where the system has none (Linux):
// fences, roots and big operators stretch only in a font with a MATH table.
mkdirSync('dist/renderer/fonts', { recursive: true })
cpSync('node_modules/@fontsource/stix-two-math/files/stix-two-math-latin-400-normal.woff2', 'dist/renderer/fonts/stix-two-math.woff2')
cpSync('node_modules/@fontsource/stix-two-math/LICENSE', 'dist/renderer/fonts/STIX-Two-Math-OFL.txt')
