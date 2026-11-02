# Entwicklung

## Was Sie brauchen

- Node.js 22 und pnpm 10.
- Sonst nichts: Electron lädt seine Binärdatei beim ersten Start herunter.

## Befehle

```sh
pnpm install
pnpm start          # bauen, dann aus den Quellen starten
pnpm build          # nach dist/ bauen
pnpm lint
pnpm typecheck
pnpm test           # Unit-Tests (vitest)
pnpm test:e2e       # die gebaute App starten und prüfen (Playwright)
```

Aus den Quellen gestartet, legt folio seine Daten in `.folio-data/` im
Arbeitsverzeichnis ab; `FOLIO_DATA=/some/dir pnpm start` legt sie woanders ab. `FOLIO_COMMIT_PAUSE` (Millisekunden) verkürzt die Pause vor einem Commit beim Speichern, für Tests; `FOLIO_GIT=builtin` synchronisiert ohne das System-git (`FOLIO_GIT=/pfad/zu/git` nennt ein bestimmtes). Die Sync-Tests lassen den eingebauten Transport gegen `git http-backend` laufen und brauchen daher ein installiertes git. Die PDF-Tests lesen die exportierten Dateien mit poppler (`pdftotext`, `pdfinfo`), wenn es installiert ist — CI installiert es unter Linux und macOS und verlangt es dort (`FOLIO_REQUIRE_POPPLER=1`).

Unter Linux ohne Bildschirm laufen die End-to-End-Tests unter einem virtuellen:
`xvfb-run --auto-servernum pnpm test:e2e`.

## Portable Builds

```sh
pnpm dist           # bauen, dann die Archive für dieses System nach release/
node scripts/checksums.mjs release
FOLIO_APP=… FOLIO_ARCHIVE=… pnpm exec playwright test -c playwright.package.config.ts --workers=1
```

`electron-builder.yml` erzeugt ein Zip unter macOS (Apple Silicon und Intel,
ad hoc signiert) und Windows sowie ein AppImage unter Linux. `tests/package/`
startet das entpackte Programm: alle Widgets, eine Konsole, ein PDF, seine
Daten daneben und ein Update an seinem Platz (`FOLIO_UPDATE_URL` lenkt das
Update auf einen lokalen Server). Der Release-Workflow tut all das auf den drei
Systemen; ein `v*`-Tag, der zur Version in `package.json` passt, veröffentlicht
die Archive mit Prüfsummen und Herkunftsnachweis.

## Aufbau

| Pfad | Was |
|---|---|
| `src/main/` | der Hauptprozess: Fenster, Festplatte, Netzregeln |
| `src/preload/` | die Brücke, die ein Fenster aufrufen darf |
| `src/renderer/` | die Seite des Fensters |
| `scripts/build.mjs` | esbuild: Main, Preload und Seite nach `dist/` |
| `tests/unit/` | Unit-Tests |
| `tests/e2e/` | die gebaute App, gestartet und gesteuert |
| `docs/internal/` | Entscheidungen und Pläne (auf Russisch) |

## CI

`.github/workflows/tests.yml` führt bei jeder Änderung Lint, Typen, Unit-Tests,
den Build und die End-to-End-Prüfung unter Linux, macOS und Windows aus. Actions
sind per Commit festgelegt.
