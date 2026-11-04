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
pnpm readme:shots   # переснять скриншоты README в docs/images (нужен ImageMagick)
```

При запуске из исходников folio хранит данные в `.folio-data/` рабочего
каталога; `FOLIO_DATA=/some/dir pnpm start` кладёт их в другое место. `FOLIO_COMMIT_PAUSE` (миллисекунды) сокращает паузу перед коммитом при сохранении — для тестов; `FOLIO_GIT=builtin` синхронизирует без системного git (`FOLIO_GIT=/путь/к/git` указывает конкретный). Тесты синхронизации гоняют встроенный транспорт против `git http-backend`, поэтому им нужен установленный git. Тесты PDF читают экспортированные файлы через poppler (`pdftotext`, `pdfinfo`), если он установлен; CI ставит его на Linux и macOS и там требует (`FOLIO_REQUIRE_POPPLER=1`).

На Linux без дисплея сквозные тесты запускают под виртуальным:
`xvfb-run --auto-servernum pnpm test:e2e`.

e2e-тесты запускают folio тихо (`FOLIO_E2E=1`, ставит конфиг Playwright): без
значка в Dock, окна не забирают фокус, нет диалога «открыть окна снова»; на
рабочей машине — по два одновременно, в CI — сколько позволяет машина.
Приветственный документ при первом запуске открывается только если тест его
просит (`FOLIO_WELCOME=1`). Тесты ревью (наборы изменений, worktree, хук) ходят в
системный git, поэтому им нужен установленный git.

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
| `src/common/` | общее для обоих: построчный дифф, фрагменты изменений, группы вкладок, наборы изменений, языки |
| `src/locales/` | словари: `en.json` — базовый, `ru.json` — второй (ADR-005) |
| `src/welcome/` | приветственный документ только для чтения, по одному на язык |
| `build/icons/` | иконка: `folio.svg` (от 48 px), `folio-small.svg` (16–32 px); `node scripts/icons.mjs` рисует из них PNG, `.icns` и `.ico` |
| `scripts/build.mjs` | esbuild: main, preload и страница в `dist/` |
| `tests/unit/` | юнит-тесты |
| `tests/e2e/` | собранное приложение, запущенное и управляемое |
| `tests/readme/` | скриншоты README, их снимает `pnpm readme:shots` |
| `docs/internal/` | решения и планы |

## CI

`.github/workflows/tests.yml` на каждое изменение прогоняет линтер, типы,
юнит-тесты, сборку и сквозную проверку на Linux, macOS и Windows. Actions
закреплены по коммиту.
