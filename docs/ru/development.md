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
каталога; `FOLIO_DATA=/some/dir pnpm start` кладёт их в другое место. `FOLIO_COMMIT_PAUSE` (миллисекунды) сокращает паузу перед коммитом при сохранении — для тестов.

На Linux без дисплея сквозные тесты запускают под виртуальным:
`xvfb-run --auto-servernum pnpm test:e2e`.

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
