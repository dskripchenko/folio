# Разработка

## Что нужно

- Node.js 22 и pnpm 10.
- Больше ничего: Electron скачивает свой бинарник при первом запуске.

## Команды

```sh
pnpm install
pnpm start          # собрать и запустить из исходников
pnpm build          # собрать в dist/
pnpm lint
pnpm typecheck
pnpm test           # юнит-тесты (vitest)
pnpm test:e2e       # запустить собранное приложение и проверить (Playwright)
```

При запуске из исходников folio хранит данные в `.folio-data/` рабочего
каталога; `FOLIO_DATA=/some/dir pnpm start` кладёт их в другое место. `FOLIO_COMMIT_PAUSE` (миллисекунды) сокращает паузу перед коммитом при сохранении — для тестов; `FOLIO_GIT=builtin` синхронизирует без системного git (`FOLIO_GIT=/путь/к/git` указывает конкретный). Тесты синхронизации гоняют встроенный транспорт против `git http-backend`, поэтому им нужен установленный git. Тесты PDF читают экспортированные файлы через poppler (`pdftotext`, `pdfinfo`), если он установлен; CI ставит его на Linux и macOS и там требует (`FOLIO_REQUIRE_POPPLER=1`).

На Linux без дисплея сквозные тесты запускают под виртуальным:
`xvfb-run --auto-servernum pnpm test:e2e`.

## Portable-сборки

```sh
pnpm dist           # сборка, затем архивы для этой системы в release/
node scripts/checksums.mjs release
FOLIO_APP=… FOLIO_ARCHIVE=… pnpm exec playwright test -c playwright.package.config.ts --workers=1
```

`electron-builder.yml` делает zip на macOS (Apple Silicon и Intel, подпись ad
hoc) и Windows и AppImage на Linux. `tests/package/` запускает распакованную
программу: все виджеты, консоль, PDF, данные рядом и обновление на её место
(`FOLIO_UPDATE_URL` направляет обновление на локальный сервер). Workflow
release делает всё это на трёх системах; тег `v*`, совпадающий с версией в
`package.json`, публикует архивы с контрольными суммами и подписью
происхождения.

## Раскладка

| Путь | Что |
|---|---|
| `src/main/` | главный процесс: окна, диск, правила сети |
| `src/preload/` | мост, который может вызывать окно |
| `src/renderer/` | страница окна |
| `scripts/build.mjs` | esbuild: main, preload и страница в `dist/` |
| `tests/unit/` | юнит-тесты |
| `tests/e2e/` | собранное приложение, запущенное и управляемое |
| `docs/internal/` | решения и планы |

## CI

`.github/workflows/tests.yml` на каждое изменение прогоняет линтер, типы,
юнит-тесты, сборку и сквозную проверку на Linux, macOS и Windows. Actions
закреплены по коммиту.
