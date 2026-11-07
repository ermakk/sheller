# Sheller — описание проекта

**Sheller** — десктопный SSH/Mosh/Telnet-клиент для Windows с графическим интерфейсом: встроенный терминал, SFTP, проброс портов, jump-хосты, прокси, сниппеты, управление Cron и мониторинг нагрузки сервера.

## Стек

- **Язык:** TypeScript 5.5 (строгий режим, отдельные конфиги для node и web)
- **Платформа:** Electron 33
- **UI:** React 18, xterm.js (`@xterm/xterm`, addon-fit, addon-web-links), lucide-react, recharts
- **Сборка:** electron-vite 2 + Vite 5; упаковка — electron-builder 24 (NSIS, Windows)
- **Сетевые протоколы:** `ssh2` (SSH, SFTP, туннели, jump-хосты), `node-pty` + mosh-client (Mosh), `telnet-client` (Telnet), `socks` (SOCKS5-прокси), `zmodem2` (передача файлов в терминале)
- **Обновления:** `electron-updater` через GitHub Releases
- **Хранилище:** JSON-файлы в каталоге `userData`; секреты шифруются через Electron `safeStorage`
- **Сторонние ресурсы:** `third_party/mosh` (mosh-client и библиотеки MSYS2), лицензии в `third_party/mosh/NOTICE.md`

## Архитектура

Процессная модель Electron разделена на четыре области:

```
src/
├── main/       — главный процесс: окна, трей, IPC-обработчики, сессии, хранилища, автообновление
├── preload/    — contextBridge-мост: window.sheller и window.updater
├── renderer/   — React-приложение (App.tsx + компоненты)
└── shared/     — общие типы и контракты (IPC-каналы, модели, утилиты)
```

- **Контракт IPC** централизован в `src/shared/types.ts` (объект `IPC`, типы запросов/событий). Каналы вызываются из preload через `ipcRenderer.invoke/send`, обрабатываются в main через `ipcMain.handle/on`.
- **Мост preload** (`src/preload/index.ts`) строго типизирован (`ShellerApi`, `UpdaterApi`); включены `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Main-сервисы:** `ProfileStore` (профили, шифрование, импорт/экспорт, цепочки jump-хостов), `SnippetStore`, `SessionManager` (жизненный цикл SSH/Mosh/Telnet-сессий, туннели, SFTP, ZMODEM, мониторинг), `setupAutoUpdater`.
- **Renderer:** `App.tsx` управляет состоянием профилей, сессий, вкладок, сплит-панелей, тостов и диалогов; компоненты в `src/renderer/src/components/` отвечают за отдельные области UI.
- **Событийная модель:** main отправляет события (`event:session-data`, `event:session-status`, `event:session-tunnels`, прогресс передач, статистику, обновления); renderer подписывается через `window.sheller.events.*`.

## Ключевые потоки

- **Подключение:** renderer → `sessions.connect` → `SessionManager` строит цепочку профилей (jump-хосты), применяет прокси, поднимает SSH-канал, запускает PTY/mosh-client или telnet; статусы и данные стримятся событиями.
- **Секреты:** пароли и парольные фразы шифруются `safeStorage` перед записью в `profiles.json`; при отсутствии шифрования используется явно помеченный plain-режим с предупреждением.
- **Туннели:** local/remote/dynamic (SOCKS5) управляются в `SessionManager`, состояние транслируется в UI.
- **SFTP:** список/загрузка/скачивание/удаление/переименование/создание каталогов; прогресс передаётся событиями.
- **Мониторинг:** периодический сбор CPU/RAM/диска/температуры удалённого сервера, графики на recharts.

## Сборка и проверки

- `npm run dev` — запуск electron-vite в режиме разработки
- `npm run build` — сборка main/preload/renderer в `out/`
- `npm run typecheck` — `tsc --noEmit` для node- и web-конфигов
- `npm run test` — тесты Vitest; `npm run test:coverage` — с покрытием
- `npm run dist` — сборка и упаковка Windows-установщика в `release/`
- `npm run release` — сборка и публикация в GitHub Releases

Проверка корректности: `npm run typecheck`, `npm run test` и ручная проверка приложения. Renderer-тесты выполняются в jsdom, main/preload/shared — в Node.

## Архитектура

Подробные архитектурные правила и границы модулей описаны в `.ai-factory/ARCHITECTURE.md`. Новый код следует Structured Modules (Technical Layer): модули с `Controllers`, `Services`, `Repositories`, `Models` и публичным API через `index.ts`.

## Ограничения и соглашения

- Целевая платформа — Windows (трей, NSIS, mosh-client); часть кода содержит платформенные ветки.
- Пользовательские строки интерфейса и сообщения об ошибках — на русском языке.
- Сторонние зависимости подключаются через `externalizeDepsPlugin` в main/preload; renderer-алиасы: `@shared`, `@renderer`.
