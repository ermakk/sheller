# AGENTS.md

> Структурная карта проекта для AI-агентов и новых разработчиков. Обновляйте при значительных изменениях структуры.

## Обзор проекта

Sheller — десктопный SSH/Mosh/Telnet-клиент для Windows на Electron с React-интерфейсом: терминал, SFTP, туннели, jump-хосты, прокси, сниппеты, Cron и мониторинг сервера.

## Технологический стек

- **Язык:** TypeScript 5.5
- **Платформа:** Electron 33
- **UI:** React 18, xterm.js, recharts, lucide-react
- **Сборка:** electron-vite 2 + Vite 5, electron-builder 24 (NSIS)
- **База данных:** нет; JSON-хранилище в `userData`, секреты через Electron `safeStorage`
- **ORM:** нет

## Структура проекта

```
src/
├── main/              # Главный процесс: окна, трей, IPC, сессии, хранилища
│   ├── index.ts       # Точка входа, registerIpc(), окна, CSP
│   ├── profiles.ts    # ProfileStore: профили и шифрование секретов
│   ├── sessions.ts    # SessionManager: SSH/Mosh/Telnet, туннели, SFTP
│   ├── snippets.ts    # SnippetStore
│   └── updater.ts     # Автообновление через electron-updater
├── test/              # Общие фабрики и setup для Vitest
├── preload/           # contextBridge: window.sheller / window.updater
│   └── index.ts
├── renderer/          # React-приложение
│   ├── index.html
│   └── src/
│       ├── main.tsx   # Точка входа renderer
│       ├── App.tsx    # Основное состояние и композиция UI
│       ├── DetachedApp.tsx
│       ├── components/ # Модалки, панели, терминал, вкладки
│       ├── utils.ts   # Форматирование и вспомогательные функции
│       └── styles.css
└── shared/            # Общие типы, IPC-контракты, шорткаты
    ├── types.ts
    └── shortcuts.ts

build/                 # Иконки приложения для electron-builder
docs/                  # Скриншоты и материалы документации
third_party/mosh/      # Встроенный mosh-client и лицензии
out/                   # Результат сборки (генерируется)
release/               # Установщики (генерируется)
```

## Ключевые точки входа

| Файл | Назначение |
|------|------------|
| `package.json` | Скрипты, зависимости, конфигурация electron-builder |
| `electron.vite.config.ts` | Сборка main/preload/renderer, алиасы `@shared` и `@renderer` |
| `src/main/index.ts` | Запуск приложения, IPC, трей, CSP, диалоги |
| `src/preload/index.ts` | Единственный мост к renderer |
| `src/renderer/src/main.tsx` | Монтирование React |
| `src/renderer/src/App.tsx` | Основной UI и подписки на события |
| `src/shared/types.ts` | Каналы IPC и общие типы |
| `src/main/sessions.ts` | Логика подключений, туннелей и передач |
| `src/main/profiles.ts` | Хранение и шифрование профилей |

## Документация

| Документ | Путь | Описание |
|----------|------|----------|
| README | `README.md` | Лендинг: возможности и быстрый старт |
| Начало работы | `docs/getting-started.md` | Установка и первое подключение |
| Архитектура | `docs/architecture.md` | Процессы, IPC и структура |
| Подключения | `docs/connections.md` | SSH/Mosh/Telnet, jump-хосты, прокси |
| Передача файлов | `docs/file-transfer.md` | SFTP и ZMODEM |
| Туннели | `docs/tunnels.md` | Проброс портов |
| Автоматизация | `docs/automation.md` | Сниппеты, Cron и мониторинг |
| Конфигурация | `docs/configuration.md` | Профили и хранилище |
| Безопасность | `docs/security.md` | Секреты, CSP и host key |
| Разработка | `docs/development.md` | Сборка, скрипты и релиз |
| Диагностика | `docs/troubleshooting.md` | Типовые ошибки |
| Лицензии Mosh | `third_party/mosh/NOTICE.md` | Сторонние компоненты и исходники |
| Скриншот | `docs/app.png` | Изображение интерфейса |

## Контекст для AI

| Файл | Назначение |
|------|------------|
| `AGENTS.md` | Структурная карта проекта (этот файл) |
| `.ai-factory/DESCRIPTION.md` | Стек, архитектура и ключевые потоки |
| `.ai-factory/ARCHITECTURE.md` | Архитектурные правила и границы |
| `.ai-factory/config.yaml` | Настройки AI Factory (язык, git, workflow) |
| `.ai-factory/rules/base.md` | Базовые соглашения по коду |

## Команды сборки

Проект использует `Taskfile.yml`. Если Task не установлен (`winget install Task.Task`), доступны npm-скрипты.

- `task typecheck` / `npm run typecheck` — обязательно перед завершением изменений
- `task test` / `npm run test` — тесты Vitest; покрытие — `npm run test:coverage`
- `task build` / `npm run build` — проверка сборки
- `task dist` / `npm run dist` — NSIS-установщик (не запускать без необходимости)
- `task check` — typecheck и тесты
- `task ci` — локальный аналог CI
- `task clean` — удалить `out/` и `release/`

Полный список: `task --list`.

## Правила для агентов

- Разбивайте составные shell-команды на отдельные шаги.
  - Неправильно: `git checkout main && git pull`
  - Правильно: сначала `git checkout main`, затем `git pull origin main`
- Перед завершением изменений запускайте `npm run typecheck`.
- Не запускайте `npm run dist`/`npm run release` без явной необходимости.
- Не логируйте пароли, парольные фразы и содержимое приватных ключей.
- Пользовательские строки интерфейса и сообщения об ошибках — на русском.
- Новые IPC-каналы добавляйте по цепочке `shared/types.ts` → `preload` → `main` → `renderer`.
