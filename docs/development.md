[← Security](security.md) · [Back to README](../README.md) · [Troubleshooting →](troubleshooting.md)

# Разработка

Проект использует TypeScript, Electron, React и electron-vite. Сборка состоит из main/preload/renderer-бандлов и NSIS-установщика.

## Стек

| Компонент | Версия |
|-----------|--------|
| TypeScript | 5.5 |
| Electron | 33 |
| React | 18 |
| electron-vite | 2 |
| Vite | 5 |
| electron-builder | 24 |
| xterm.js | 5.5 |
| ssh2 | 1.16 |

## Требования

- Node.js 20+
- npm
- Windows 10/11 для сборки установщика

## Установка и запуск

```powershell
npm install
npm run dev
```

`npm run dev` запускает electron-vite с горячей перезагрузкой renderer.

## Скрипты

| Скрипт | Действие |
|--------|----------|
| `npm run dev` | Запуск в режиме разработки |
| `npm run build` | Сборка в `out/` без установщика |
| `npm run preview` | Предпросмотр собранного приложения |
| `npm run typecheck` | Проверка типов main и renderer |
| `npm run test` | Однократный прогон тестов Vitest |
| `npm run test:watch` | Тесты в режиме наблюдения |
| `npm run test:coverage` | Тесты с отчётом покрытия в `coverage/` |
| `npm run dist` | Сборка + NSIS-установщик в `release/` |
| `npm run release` | Сборка и публикация в GitHub Releases |

Перед завершением изменений обязательно выполняйте `npm run typecheck` и `npm run test`.

### Taskfile

Основные сценарии собраны в `Taskfile.yml`:

| Команда | Действие |
|---------|----------|
| `task` | Список задач |
| `task dev` | Запуск в режиме разработки |
| `task typecheck` | Проверка типов |
| `task test` | Тесты с покрытием |
| `task build` | Сборка в `out/` |
| `task dist` | NSIS-установщик в `release/` |
| `task audit` | Аудит runtime-зависимостей |
| `task check` | Typecheck и тесты |
| `task ci` | Локальный аналог CI |
| `task clean` | Удалить `out/` и `release/` |

Установка Task на Windows: `winget install Task.Task`. npm-скрипты остаются доступными напрямую.

## Структура

```
src/main/       # Electron main: IPC, сессии, профили, сниппеты, updater
src/preload/    # contextBridge API
src/renderer/   # React UI и styles.css
src/shared/     # типы, IPC-каналы, шорткаты
src/test/       # общие фабрики и setup для Vitest
build/          # иконки
third_party/    # mosh-client и лицензии
```

## Добавление IPC-канала

1. Добавьте имя в `IPC` и типы в `src/shared/types.ts`.
2. Опишите метод в `ShellerApi`.
3. Реализуйте вызов в `src/preload/index.ts`.
4. Зарегистрируйте `ipcMain.handle` в `src/main/index.ts`.
5. Вызовите метод из renderer через `window.sheller`.

Для событий main → renderer используйте префикс `event:` и подписку, возвращающую функцию отписки.

## Соглашения

- Отступ — 2 пробела, одинарные кавычки, без точек с запятой.
- Имена: `camelCase` для переменных и функций, `PascalCase` для компонентов и классов, `UPPER_SNAKE_CASE` для констант.
- Ранний возврат вместо вложенных условий.
- Ошибки IPC возвращаются как `ApiResult { ok: false, error }`; для сообщений используйте `describeError`.
- Пользовательские строки и ошибки — на русском.
- Не логируйте пароли, парольные фразы и содержимое ключей.
- Не добавляйте комментарии без необходимости.

Архитектурные правила для новых модулей: `.ai-factory/ARCHITECTURE.md`. Базовые соглашения: `.ai-factory/rules/base.md`.

## CI

GitHub Actions workflows:

| Workflow | Проверка | Окружение |
|----------|----------|-----------|
| `.github/workflows/typecheck.yml` | `npm run typecheck` | Ubuntu, Node 22 |
| `.github/workflows/tests.yml` | `npm run test:coverage` | Ubuntu, Node 22 |
| `.github/workflows/build.yml` | `npm run build` | Windows, Node 22 |
| `.github/workflows/security.yml` | `npm audit --omit=dev --audit-level=high` | Ubuntu, Node 22 |

Триггеры: push в `main`, pull request и ручной запуск. Аудит зависимостей также выполняется по понедельникам. Отчёт покрытия из workflow `tests.yml` сохраняется артефактом на 7 дней.

## Сборка и упаковка

- `electron-builder` кладёт `out/**/*` и `package.json` в asar.
- `node-pty` распаковывается из asar (`asarUnpack`).
- `third_party/mosh` копируется в ресурсы приложения.
- Целевой формат — NSIS с выбором каталога и ярлыком на рабочем столе.
- Публикация настроена на GitHub (`ermakk/sheller`).

`npm run release` выполняет `--publish always`, поэтому требует настроенного GitHub-токена и прав на репозиторий. Не запускайте `dist`/`release` без необходимости.

## Тесты

Тесты запускаются через Vitest: `npm run test`, наблюдаемый режим — `npm run test:watch`, покрытие — `npm run test:coverage`. Конфигурация находится в `vitest.config.ts`, общие моки и фабрики — в `src/test/`.

- Main/preload/shared-тесты выполняются в окружении Node.
- Renderer-тесты используют jsdom: первой строкой файла указывайте `// @vitest-environment jsdom`.
- Для компонентов применяются Testing Library и `@testing-library/jest-dom`; события клавиатуры должны содержать `code`, если проверяются шорткаты.
- Портал-компоненты ищутся через `document`/`screen`, а не внутри контейнера `render`.

Минимальная проверка изменений:

1. `npm run typecheck`
2. `npm run test`
3. `npm run build`
4. Ручной сценарий: подключение SSH/Mosh, терминал, SFTP, туннель, сниппет, Cron, мониторинг.

## See Also

- [Architecture](architecture.md) — процессы и IPC.
- [Configuration](configuration.md) — формат профилей.
- [Troubleshooting](troubleshooting.md) — диагностика сборки и запуска.
