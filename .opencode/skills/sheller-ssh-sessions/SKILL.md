---
name: sheller-ssh-sessions
description: >-
  Работа с SessionManager Sheller: жизненный цикл SSH, Mosh и Telnet-сессий,
  jump-хосты, прокси, туннели, SFTP, ZMODEM, мониторинг и Cron.
  Используйте при изменении подключений, туннелей, передач файлов,
  обработке паролей/host key и событий сессии.
---

# Sheller: SSH-сессии и подключения

Руководство по главному процессу подключений в `src/main/sessions.ts`.

## Когда применять

- Изменение подключения SSH, Mosh или Telnet.
- Работа с jump-хостами, SOCKS5/HTTP-прокси, keepalive, host key.
- Туннели local/remote/dynamic.
- SFTP-операции, прогресс и отмена передач.
- ZMODEM, мониторинг нагрузки, Cron.
- Новые события или поля `ManagedSession`.

## Карта файлов

| Файл | Назначение |
|------|------------|
| `src/main/sessions.ts` | `SessionManager`, протоколы, туннели, SFTP, ZMODEM, статистика |
| `src/main/profiles.ts` | `ProfileStore`, шифрование секретов, цепочки jump-хостов |
| `src/shared/types.ts` | `SessionConnectRequest`, статусы, события, `TunnelConfig` |
| `src/main/index.ts` | IPC-обработчики, вызывающие `SessionManager` |
| `src/renderer/src/App.tsx` | Подписки на события, состояние вкладок и передач |

## Жизненный цикл `connect()`

1. Проверка `sessionId` и `profileId`; отмена ранее отменённой сессии.
2. Если сессия уже существует и подключена — обновляются размеры PTY и возвращается `{ ok: true }`.
3. `ProfileStore.resolveChain(profileId)` строит цепочку jump-хостов от ближайшего к целевому.
4. Создаётся `ManagedSession`, отправляется статус `connecting`, публикуются туннели.
5. Для Mosh заранее разрешается клиент: пользовательский путь, WSL или встроенный `third_party/mosh`.
6. Telnet обрабатывается отдельной веткой `connectTelnet()`.
7. Для SSH последовательно поднимаются клиенты по цепочке; между хостами используется `forwardOut`.
8. Для каждого хоста: прокси-сокет, `hostVerifier` (SHA256 fingerprint), пароль/ключ/agent, `keepaliveInterval`.
9. На целевом хосте: Mosh-канал или `shell({ term: 'xterm-256color' })`.
10. Успех: `setupStream()`, `ensureRemoteDispatcher()`, статус `connected`, `touch()`, автозапуск туннелей.
11. Любая ошибка: `endSession(session, 'error', msg)` и `{ ok: false, error }`.

## События

Отправляются через переданный в конструктор `send` (в `index.ts` это `broadcast`):

| Событие | Когда |
|---------|-------|
| `event:session-data` | Данные терминала |
| `event:session-status` | `connecting` / `connected` / `disconnected` / `error` |
| `event:session-tunnels` | Изменение состояния туннелей |
| `event:session-transfer` | Прогресс SFTP |
| `event:session-zmodem` | Старт/конец ZMODEM |
| `event:hostkey-verify` | Неизвестный host key, нужен ответ пользователя |
| `event:request-password` | Требуется пароль |
| `event:session-stats` | Статистика нагрузки |

## Аутентификация и host key

- Пароль запрашивается через `requestPassword(session)`; ответ приходит в `providePassword(sessionId, password)`.
- Неизвестный host key: вычисляется `SHA256:<base64>` и отправляется `event:hostkey-verify`; ответ — `provideHostKey(sessionId, accept)`.
- При принятии нового ключа профиль обновляется через `ProfileStore.update`.
- Пароли и парольные фразы хранятся только в зашифрованном виде (`safeStorage`); не логируйте их.

## Туннели

- Типы: `local`, `remote`, `dynamic` (SOCKS5).
- Состояние каждого туннеля: `TunnelState` (`config`, `status`, `generation`, `sockets`, `server`, `boundHost`, `boundPort`).
- При остановке/перезапуске увеличивайте `generation`, закрывайте серверы и все сокеты.
- Автозапуск выполняется после успешного подключения (`startAutoTunnels`).
- Изменения транслируются через `emitTunnels`.

## SFTP и передачи

- Операции: `listRemote`, `uploadPath`, `downloadPath`, `deleteRemote`, `mkdirRemote`, `renameRemote`.
- `MAX_CONCURRENT_FILES = 2`; лишние передачи ставятся в очередь.
- Отмена — через `cancelTransfer(transferId)` и множество `cancelledTransfers`; проверяйте отмену до и во время копирования.
- Прогресс отправляется событием `event:session-transfer`; завершение всегда содержит `done: true`.
- Пути валидируются на уровне IPC; не выполняйте shell-команды с пользовательскими путями без экранирования.

## ZMODEM

- Состояния: `idle`, `receiving`, `sending`.
- События `download-start/end`, `upload-start/end`, `error`.
- Не начинайте новую передачу, пока `zmodemState !== 'idle'`.

## Мониторинг и Cron

- `startStatsPolling(sessionId)` / `stopStatsPolling(sessionId)` управляют интервалами в `statsIntervals`; всегда очищайте их при завершении сессии.
- `cronList` / `cronSave` работают с удалённым crontab; исходные строки кэшируются в `cronRaw`.

## Правила изменений

- Любой путь завершения должен проходить через `endSession()`: закрывайте клиентов, сокеты, серверы, PTY и интервалы.
- Проверяйте `session.closed` после асинхронных шагов, чтобы не продолжать работу с закрытой сессией.
- Новые поля добавляйте в `ManagedSession` и инициализируйте при создании.
- Для сообщений пользователю используйте `describeError()`; технические детали — в `console.error`.
- Не храните в событиях пароли, ключи и содержимое файлов.
- При изменении контракта обновляйте `src/shared/types.ts`, preload и renderer.

## Проверка

- `npm run typecheck` — обязательная проверка.
- Ручной сценарий через `npm run dev`: подключение по SSH, jump-хост, туннель, SFTP, отмена передачи, разрыв и повторное подключение.
- Для Mosh проверьте наличие `mosh-server` на сервере и UDP-порты 60000–61000.

## Частые ошибки

- Забыт `endSession` при ошибке — утечка клиентов и сокетов.
- Не очищены `statsIntervals` или таймеры после отключения.
- Отправка данных в поток после `closed`/`disconnected`.
- Игнорирование `cancelledTransfers` — передача продолжается после отмены.
- Хранение секретов в открытом виде в `ManagedSession` или событиях.
