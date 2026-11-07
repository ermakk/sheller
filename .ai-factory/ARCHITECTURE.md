# Архитектура: Structured Modules (Technical Layer)

## Обзор

Sheller строится как модульный монолит в рамках Electron. Каждая функциональная область (профили, сессии, сниппеты, обновления) оформляется отдельным модулем со своей технической структурой: `Controllers` (точки входа IPC), `Services` (оркестрация сценариев), `Repositories` (доступ к файлам, сети и `safeStorage`) и `Models` (доменные типы и DTO). Модуль предоставляет наружу только публичный API через `index.ts`.

Архитектура выбрана потому, что приложение уже разделено на процессы Electron и несколько независимых функциональных областей. Structured Modules сохраняет это разделение и добавляет явные границы модулей без избыточной формальности Explicit Architecture.

## Обоснование решения

- **Тип проекта:** десктопный SSH/Mosh/Telnet-клиент для Windows.
- **Технологический стек:** TypeScript, Electron 33, React 18, electron-vite.
- **Ключевой фактор:** несколько функциональных областей с разной инфраструктурой (сеть, файлы, `safeStorage`, обновления) и жёсткая граница между main и renderer.
- **Ограничения:** пароли и ключи не должны покидать main-процесс; IPC-контракт должен оставаться типизированным и централизованным.

## Структура папок

Эталонная схема для нового кода:

```
src/
├── main/                                       # Главный процесс
│   ├── modules/                                # ФУНКЦИОНАЛЬНЫЕ МОДУЛИ
│   │   ├── profiles/
│   │   │   ├── Controllers/                    # IPC-обработчики, валидация входа
│   │   │   │   └── ProfilesController.ts
│   │   │   ├── Services/                       # Сценарии использования
│   │   │   │   └── ProfilesService.ts
│   │   │   ├── Repositories/                   # Файлы, safeStorage, импорт/экспорт
│   │   │   │   └── ProfileRepository.ts
│   │   │   ├── Models/                         # Доменные типы и DTO
│   │   │   │   └── Profile.ts
│   │   │   └── index.ts                        # Публичный API модуля
│   │   ├── sessions/
│   │   │   ├── Controllers/
│   │   │   ├── Services/
│   │   │   ├── Repositories/
│   │   │   ├── Models/
│   │   │   └── index.ts
│   │   ├── snippets/
│   │   ├── updater/
│   │   └── windows/                            # Окна, трей, detached-окна
│   │
│   ├── Infrastructure/                         # КРОСС-МОДУЛЬНАЯ ИНФРАСТРУКТУРА
│   │   ├── Ipc/                                # Регистрация каналов и трансляция событий
│   │   ├── Security/                           # CSP, внешние ссылки, ограничения окон
│   │   ├── Config/                             # Пути приложения, окружение
│   │   └── Utils/
│   └── index.ts                                # Composition root: сборка модулей и запуск
│
├── preload/                                    # Мост contextBridge
│   └── index.ts                                # Только типизированные вызовы, без бизнес-логики
│
├── renderer/                                   # React-приложение
│   ├── index.html
│   └── src/
│       ├── modules/                            # ФУНКЦИОНАЛЬНЫЕ МОДУЛИ UI
│       │   ├── connections/
│       │   │   ├── Controllers/                # Контейнеры и страницы
│       │   │   ├── Services/                   # Хуки и состояние сценариев
│       │   │   ├── Models/                     # View-модели
│       │   │   └── index.ts                    # Публичный API модуля
│       │   ├── terminal/
│       │   ├── sftp/
│       │   ├── tunnels/
│       │   ├── snippets/
│       │   ├── monitor/
│       │   └── settings/
│       │
│       ├── Infrastructure/                     # КРОСС-МОДУЛЬНАЯ ИНФРАСТРУКТУРА UI
│       │   ├── Api/                            # Обёртки над window.sheller
│       │   ├── UI/                             # Общие компоненты (тосты, диалоги)
│       │   ├── Styles/
│       │   └── Utils/
│       │
│       ├── App.tsx                             # Композиция модулей
│       └── main.tsx                            # Точка входа
│
└── shared/                                     # КОНТРАКТЫ
    ├── Types/                                  # IPC-каналы, DTO, события
    └── Utils/                                  # Чистые утилиты без Electron
```

**Текущее состояние:** структура `src/main/*.ts`, `src/renderer/src/components/*` и `src/shared/*` является legacy. Она сохраняется до целенаправленного рефакторинга; правила ниже обязательны для нового кода и для кода, который перемещается в модули.

## Правила зависимостей

Направление зависимостей строго сверху вниз:

```
Controllers → Services → Repositories
                 ↓
               Models
```

- ✅ `main/modules/<module>/Controllers` зависит от `Services` своего модуля.
- ✅ `Services` зависит от `Repositories` и `Models` своего модуля.
- ✅ `Repositories` и `Models` не зависят от `Controllers` и `Services`.
- ✅ Все процессы могут использовать `src/shared` (контракты и чистые утилиты).
- ✅ Модули используют `main/Infrastructure` и `renderer/Infrastructure` для сквозных задач.
- ❌ Renderer не импортирует код из `src/main`.
- ❌ Main не импортирует код из `src/renderer`.
- ❌ Один модуль не импортирует внутренности другого модуля — только его `index.ts`.
- ❌ `shared` не импортирует Electron, React или код процессов.
- ❌ Циклические зависимости между модулями.
- ❌ Бизнес-логика в `preload` или в IPC-обработчиках.

## Взаимодействие слоёв и модулей

- **IPC как граница:** renderer вызывает методы `window.sheller` / `window.updater`, preload транслирует их в каналы, `Controllers` в main валидируют аргументы и вызывают `Services`.
- **События:** main отправляет события через `Infrastructure/Ipc`; renderer подписывается через preload и обновляет состояние своего модуля.
- **Публичный API модуля:** каждый модуль экспортирует из `index.ts` только контроллеры/сервисы, необходимые другим модулям или composition root.
- **Внедрение зависимостей:** сервисы получают репозитории через конструктор; composition root (`src/main/index.ts`) создаёт конкретные реализации.
- **Общие контракты:** типы запросов, ответов и событий живут в `src/shared/Types`; модули не дублируют строки каналов.
- **Секреты:** расшифрованные пароли и ключи остаются в main; renderer получает только результаты операций и события.

## Ключевые принципы

1. **Границы процессов неприкосновенны.** Main владеет сетью, файлами и секретами; renderer — только UI.
2. **Тонкие контроллеры.** IPC-обработчик валидирует вход, вызывает один метод сервиса и возвращает `ApiResult`; сценарии живут в сервисах.
3. **Репозитории скрывают инфраструктуру.** Файловое хранилище, `safeStorage`, `ssh2`, SFTP и сетевые сокеты не протекают в контроллеры.
4. **Модуль — единица изменения.** Новую функцию добавляйте в существующий модуль или создавайте новый с `Controllers/Services/Repositories/Models` и `index.ts`.
5. **Контракт раньше реализации.** Сначала канал и типы в `shared`, затем preload, main, renderer.
6. **Ошибки не раскрывают секреты.** Пользователю — сообщение на русском, в лог — технические детали без паролей и ключей.
7. **Тестируемость через сервисы.** Логика сценариев должна быть вызываема без Electron-окон; инфраструктура подставляется через репозитории.

## Политика legacy- и нового кода

- **Новые функции:** весь новый код ОБЯЗАН следовать архитектуре из этого документа.
- **Изменение legacy-кода:** не рефакторите несвязанный legacy-код автоматически. Касайтесь его только для исправления ошибок, по явной задаче рефакторинга или для подключения к новым функциям.
- **Совместимость:** если новый код вызывает legacy-код, изолируйте взаимодействие адаптерами, интерфейсами или фасадами, чтобы legacy-паттерны не проникали в новую архитектуру.
- **Перенос кода:** при переносе файла в модуль сначала добавьте реэкспорт/адаптер для старых импортов, затем переключайте потребителей и удаляйте адаптер отдельным изменением.

## Примеры кода

### 1. Контроллер → сервис → репозиторий (main)

```ts
// src/main/modules/profiles/Controllers/ProfilesController.ts
import type { ProfileDraft, ProfileActionResult } from '@shared/types'
import type { ProfilesService } from '../Services/ProfilesService'

export class ProfilesController {
  constructor(private readonly service: ProfilesService) {}

  async save(id: unknown, draft: unknown): Promise<ProfileActionResult> {
    try {
      if (!draft || typeof draft !== 'object') throw new Error('Неверный запрос')
      const profile = typeof id === 'string'
        ? await this.service.update(id, draft as ProfileDraft)
        : await this.service.create(draft as ProfileDraft)
      return { ok: true, profile }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
```

```ts
// src/main/modules/profiles/Services/ProfilesService.ts
import type { ConnectionProfile, ProfileDraft } from '@shared/types'
import type { ProfileRepository } from '../Repositories/ProfileRepository'

export class ProfilesService {
  constructor(private readonly repository: ProfileRepository) {}

  async create(draft: ProfileDraft): Promise<ConnectionProfile> {
    return this.repository.create(draft)
  }

  async update(id: string, draft: ProfileDraft): Promise<ConnectionProfile> {
    return this.repository.update(id, draft)
  }
}
```

Репозиторий реализует работу с файлом в `userData` и `safeStorage`; контроллер не знает, где и как хранятся данные.

### 2. Публичный API модуля и границы (renderer)

```ts
// src/renderer/src/modules/connections/index.ts
export { ConnectionsPage } from './Controllers/ConnectionsPage'
export type { ConnectionViewModel } from './Models/ConnectionViewModel'
```

```ts
// src/renderer/src/App.tsx — композиция модулей
import { ConnectionsPage } from './modules/connections'
import { SnippetsPanel } from './modules/snippets'

export default function App(): JSX.Element {
  return (
    <main>
      <ConnectionsPage />
      <SnippetsPanel />
    </main>
  )
}
```

Другой модуль не должен импортировать `./modules/connections/Controllers/ConnectionsPage` напрямую — только через `index.ts`.

### 3. Контракт IPC в shared

```ts
// src/shared/Types/ipc.ts
export const IPC = {
  profilesSave: 'profiles:save'
} as const

export interface ApiResult<T = unknown> {
  ok: boolean
  error?: string
  data?: T
}
```

Каналы и типы не дублируются в модулях; preload и main импортируют их из `shared`.

## Анти-паттерны

- ❌ Бизнес-логика в `ipcMain.handle` или в preload.
- ❌ Renderer напрямую использует `ipcRenderer` или импортирует код main.
- ❌ Модуль импортирует внутренние файлы другого модуля в обход `index.ts`.
- ❌ `shared` зависит от Electron, React или конкретного процесса.
- ❌ «Голые» строки каналов и типы запросов, продублированные в нескольких местах.
- ❌ Репозиторий, который управляет UI-состоянием, или сервис, который напрямую работает с `BrowserWindow`.
- ❌ Расшифрованные секреты в событиях, логах или состоянии renderer.
- ❌ Циклические зависимости и «god-сервисы», смешивающие профили, сессии и обновления.
