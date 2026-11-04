# Development

## What you need

- Node.js 22 and pnpm 10.
- Nothing else: Electron downloads its own binary on first start.

## Commands

```sh
pnpm install
pnpm start          # build, then run from the sources
pnpm build          # build into dist/
pnpm lint
pnpm typecheck
pnpm test           # unit tests (vitest)
pnpm test:e2e       # start the built app and check it (Playwright)
```

Run from the sources, folio keeps its data in `.folio-data/` in the working
directory; `FOLIO_DATA=/some/dir pnpm start` puts it elsewhere. `FOLIO_COMMIT_PAUSE` (milliseconds) shortens the pause before a commit on save, for tests; `FOLIO_GIT=builtin` syncs without the system git (`FOLIO_GIT=/path/to/git` names one). The sync tests run the built-in transport against `git http-backend`, so they need git installed. The PDF tests read the exported files with poppler (`pdftotext`, `pdfinfo`) when it is installed — CI installs it on Linux and macOS and requires it there (`FOLIO_REQUIRE_POPPLER=1`).

On Linux without a display, run the end-to-end tests under a virtual one:
`xvfb-run --auto-servernum pnpm test:e2e`.

The end-to-end tests run folio quietly (`FOLIO_E2E=1`, set by the Playwright
config): no Dock icon, windows that do not take the focus, no "reopen windows"
dialog afterwards; two at a time on a desk, as many as the machine has in CI.
The welcome document opens on a first start only when a test asks for it
(`FOLIO_WELCOME=1`). The review's tests (sets of changes, worktrees, the hook)
drive the system's git, so they need git installed.

## Portable builds

```sh
pnpm dist           # build, then the archives for this system into release/
node scripts/checksums.mjs release
FOLIO_APP=… FOLIO_ARCHIVE=… pnpm exec playwright test -c playwright.package.config.ts --workers=1
```

`electron-builder.yml` makes a zip on macOS (Apple Silicon and Intel, signed
ad hoc) and Windows and an AppImage on Linux. `tests/package/` runs the
unpacked program: every widget, a console, a PDF, its data beside it, and an
update put in its place (`FOLIO_UPDATE_URL` points the updater at a local
server). The release workflow does all of it on the three systems; a `v*` tag
whose version matches `package.json` publishes the archives with their
checksums and provenance.

## Layout

| Path | What |
|---|---|
| `src/main/` | the main process: windows, the disk, the network rules |
| `src/preload/` | the bridge a window may call |
| `src/renderer/` | the window's page |
| `src/common/` | what both use: the line diff, runs of changes, tab groups, sets of changes, the languages |
| `src/locales/` | the dictionaries: `en.json` the base, `ru.json` the second (ADR-005) |
| `src/welcome/` | the read-only welcome document, a language each |
| `build/icons/` | the icon: `folio.svg` (48 px and up), `folio-small.svg` (16–32 px); `node scripts/icons.mjs` draws the PNGs, `.icns` and `.ico` from them |
| `scripts/build.mjs` | esbuild: main, preload and page into `dist/` |
| `tests/unit/` | unit tests |
| `tests/e2e/` | the built app, started and driven |
| `docs/internal/` | decisions and plans (in Russian) |

## CI

`.github/workflows/tests.yml` runs lint, types, unit tests, the build and the
end-to-end check on Linux, macOS and Windows for every change. Actions are
pinned by commit.
