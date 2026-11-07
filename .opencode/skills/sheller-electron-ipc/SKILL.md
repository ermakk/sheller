---
name: sheller-electron-ipc
description: >-
  Добавление и изменение IPC-каналов Sheller между main, preload и renderer.
  Используйте при создании нового запроса/ответа, события main→renderer,
  диалога, API в window.sheller или window.updater, а также при отладке
  типизации и безопасности Electron IPC.
---

# Sheller: Electron IPC

Практическое руководство по сквозному изменению IPC в Sheller.

## Когда применять

- Новый запрос renderer → main (сохранение, подключение, файловая операция).
- Новое событие main → renderer (статус, прогресс, данные терминала).
- Новый метод в `window.sheller` или `window.updater`.
- Изменение типов запросов/ответов и проверок аргументов.

## Контракт IPC

Порядок слоёв строго фиксирован:

```
src/shared/types.ts     — строки каналов (IPC), типы запросов, ответов и событий
src/main/index.ts       — ipcMain.handle / ipcMain.on, валидация аргументов
src/main/updater.ts     — каналы обновлений (update:*)
src/preload/index.ts    — contextBridge: window.sheller / window.updater
src/renderer/src/**     — вызовы API и подписки на события
```

Правила:

- Строка канала объявляется только в `IPC` (`src/shared/types.ts`). Не дублируйте литералы.
- Публичный API описывается в `ShellerApi` / `UpdaterApi` (там же), реализуется в preload.
- Renderer никогда не получает `ipcRenderer` напрямую — только типизированные методы.
- Ответы на изменяющие операции возвращайте как `ApiResult`/`ProfileActionResult`: `{ ok: true, ... }` или `{ ok: false, error }`.

## Чек-лист: новый запрос/ответ

1. Добавьте канал в `IPC`:

```ts
// src/shared/types.ts
export const IPC = {
  // ...
  widgetsSave: 'widgets:save'
} as const
```

2. Опишите типы запроса и ответа рядом с доменными типами.
3. Добавьте метод в `ShellerApi` (или `UpdaterApi`) и реализуйте его в preload:

```ts
// src/preload/index.ts
const api: ShellerApi = {
  // ...
  widgets: {
    save: (draft) => ipcRenderer.invoke(IPC.widgetsSave, draft)
  }
}
```

4. Зарегистрируйте обработчик в main и проверьте входные данные:

```ts
// src/main/index.ts, внутри registerIpc()
ipcMain.handle(IPC.widgetsSave, async (_event, draft: unknown): Promise<ApiResult> => {
  try {
    if (!draft || typeof draft !== 'object') throw new Error('Неверный запрос')
    const saved = await widgetStore.save(draft)
    return { ok: true, widget: saved }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
})
```

5. Вызовите метод из renderer и обработайте ошибку через тост:

```ts
const result = await window.sheller.widgets.save(draft)
if (!result.ok) addToast('error', 'Не удалось сохранить', result.error)
```

6. Запустите `npm run typecheck` и проверьте сценарий через `npm run dev`.

## Чек-лист: новое событие main → renderer

1. Добавьте канал события (`event:*`) в `IPC` и тип payload.
2. Отправляйте событие только в живые окна:

```ts
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}
```

3. Добавьте подписку в preload через общий `subscribe<T>()` — он возвращает функцию отписки.
4. В renderer подписывайтесь в `useEffect` и обязательно возвращайте отписку:

```ts
useEffect(() => {
  return window.sheller.events.onWidgetUpdated((event) => {
    setWidgets((previous) => applyWidgetEvent(previous, event))
  })
}, [])
```

5. События с высокой частотой (данные терминала, прогресс) не должны вызывать лишние перерисовки всего приложения — обновляйте минимальную часть состояния.

## Безопасность

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — не ослабляйте эти настройки.
- В main валидируйте каждый аргумент (`typeof`, массивы, допустимые значения), не доверяйте типам из renderer.
- Не логируйте пароли, парольные фразы, содержимое ключей и токены.
- Не добавляйте `eval`, динамическое исполнение строк и сетевые вызовы, не связанные с задачей.
- Для внешних ссылок используйте существующий `openExternal` и `setWindowOpenHandler`.
- CSP задаётся в `src/main/index.ts`; не расширяйте `connect-src`/`script-src` без необходимости.

## Ошибки и совместимость

- Пользовательские сообщения — на русском, через `describeError`/`errorMessage`.
- Для необязательных аргументов используйте `unknown` + сужение типа, а не `as`.
- Обработчики `ipcMain.on` ничего не возвращают: сообщайте результат отдельным событием.
- При удалении канала удалите его из `IPC`, preload, main и всех подписок renderer.

## Ключевые файлы

| Файл | Назначение |
|------|------------|
| `src/shared/types.ts` | Каналы, типы, `ShellerApi`, `UpdaterApi` |
| `src/preload/index.ts` | Мост `window.sheller` / `window.updater` |
| `src/main/index.ts` | `registerIpc()`, окна, трей, CSP, диалоги |
| `src/main/updater.ts` | Каналы автообновления |
| `src/renderer/src/App.tsx` | Основные вызовы API и подписки на события |

## Частые ошибки

- Канал добавлен в preload, но не зарегистрирован в main (или наоборот).
- Забыта отписка в `useEffect` — утечка слушателей и обновления размонтированного компонента.
- Отправка события в уничтоженное окно без проверки `isDestroyed()`.
- Возврат сырого объекта ошибки в renderer вместо `{ ok: false, error }`.
- Ослабление `sandbox`/`contextIsolation` ради быстрого доступа к Node API.
