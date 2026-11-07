[← Getting Started](getting-started.md) · [Back to README](../README.md) · [Connections →](connections.md)

# Архитектура

Sheller построен на Electron и разделён на три процесса с общей папкой контрактов. Секреты и сетевые подключения остаются в main-процессе, renderer работает только через типизированный IPC-мост.

## Структура проекта

```
src/
├── main/              # Главный процесс: окна, трей, IPC, сессии, хранилища
│   ├── index.ts       # Точка входа, registerIpc(), окна, CSP
│   ├── profiles.ts    # ProfileStore: профили и шифрование секретов
│   ├── sessions.ts    # SessionManager: SSH/Mosh/Telnet, туннели, SFTP
│   ├── snippets.ts    # SnippetStore
│   └── updater.ts     # Автообновление через electron-updater
├── preload/           # contextBridge: window.sheller / window.updater
│   └── index.ts
├── renderer/          # React-приложение (xterm.js, recharts)
│   └── src/
│       ├── App.tsx    # Основное состояние и композиция UI
│       ├── components/
│       └── utils.ts
└── shared/            # Общие типы, IPC-контракты, шорткаты
    ├── types.ts
    └── shortcuts.ts
```

## Процессы и границы

| Слой | Ответственность | Не делает |
|------|-----------------|-----------|
| `main` | SSH/Mosh/Telnet, SFTP, туннели, файлы, секреты, обновления, трей | Не рендерит UI |
| `preload` | Узкий мост `window.sheller` и `window.updater` | Не содержит бизнес-логики |
| `renderer` | React-интерфейс, терминал xterm.js, графики | Не имеет доступа к Node.js и файловой системе |
| `shared` | Типы, имена IPC-каналов, `ShellerApi`, шорткаты | Не выполняет код платформы |

`BrowserWindow` создаётся с `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. В production включается CSP.

## IPC-контракт

Новые каналы добавляются по цепочке:

1. `src/shared/types.ts` — имя канала в `IPC` и типы запроса/ответа.
2. `src/preload/index.ts` — метод в `window.sheller`.
3. `src/main/index.ts` — `ipcMain.handle` или отправка события.
4. `src/renderer/src` — вызов через `window.sheller`.

События main → renderer используют каналы `event:*`: данные терминала, статусы, туннели, передачи, ZMODEM, статистика, запрос пароля и host key.

## Основные компоненты

| Компонент | Файл | Назначение |
|-----------|------|------------|
| `ProfileStore` | `src/main/profiles.ts` | JSON-хранилище профилей, шифрование секретов, импорт/экспорт |
| `SessionManager` | `src/main/sessions.ts` | Подключения, jump-цепочки, прокси, PTY, SFTP, туннели, Cron, статистика |
| `SnippetStore` | `src/main/snippets.ts` | Хранилище сниппетов и горячих клавиш |
| Updater | `src/main/updater.ts` | Проверка и установка обновлений |
| Preload API | `src/preload/index.ts` | Единая точка доступа renderer к main |

## Поток подключения

1. Renderer отправляет `session:connect` с `sessionId`, `profileId` и размером терминала.
2. `SessionManager` загружает профиль, проверяет цепочку jump-хостов и настройки прокси.
3. Для каждого hop устанавливается SSH-соединение; для Mosh дополнительно запускается `mosh-client`.
4. Терминал получает данные через `event:session-data`, статусы — через `event:session-status`.
5. Для SSH/Mosh-сессии создаётся SFTP-канал; туннели и мониторинг используют то же соединение.

Каждая сессия имеет собственный `sessionId` и может быть откреплена в отдельное окно без повторного подключения.

## Хранение данных

- Профили: `profiles.json` в каталоге `userData`.
- Сниппеты: `snippets.json` в каталоге `userData`.
- Запись атомарная: временный файл + переименование.
- Пароли, парольные фразы и пароли прокси шифруются через Electron `safeStorage`; renderer получает только флаги `hasPassword`/`hasPassphrase`.

Точные пути и схема данных описаны в [Configuration](configuration.md).

## Связанные соглашения

Целевая структура новых модулей и правила зависимостей зафиксированы в `.ai-factory/ARCHITECTURE.md` (Structured Modules). Текущий код сгруппирован по техническим слоям (`main`, `preload`, `renderer`, `shared`), поэтому новые функции следует добавлять в существующие слои, не смешивая доступ к сети и UI.

## See Also

- [Development](development.md) — сборка и добавление IPC-каналов.
- [Security](security.md) — изоляция процессов и хранение секретов.
- [Connections](connections.md) — жизненный цикл подключения.
