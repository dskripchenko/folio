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
Arbeitsverzeichnis ab; `FOLIO_DATA=/some/dir pnpm start` legt sie woanders ab. `FOLIO_COMMIT_PAUSE` (Millisekunden) verkürzt die Pause vor einem Commit beim Speichern, für Tests.

Unter Linux ohne Bildschirm laufen die End-to-End-Tests unter einem virtuellen:
`xvfb-run --auto-servernum pnpm test:e2e`.

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
