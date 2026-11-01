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
directory; `FOLIO_DATA=/some/dir pnpm start` puts it elsewhere.

On Linux without a display, run the end-to-end tests under a virtual one:
`xvfb-run --auto-servernum pnpm test:e2e`.

## Layout

| Path | What |
|---|---|
| `src/main/` | the main process: windows, the disk, the network rules |
| `src/preload/` | the bridge a window may call |
| `src/renderer/` | the window's page |
| `scripts/build.mjs` | esbuild: main, preload and page into `dist/` |
| `tests/unit/` | unit tests |
| `tests/e2e/` | the built app, started and driven |
| `docs/internal/` | decisions and plans (in Russian) |

## CI

`.github/workflows/tests.yml` runs lint, types, unit tests, the build and the
end-to-end check on Linux, macOS and Windows for every change. Actions are
pinned by commit.
