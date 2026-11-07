import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { UpdateInfo } from 'electron-updater'

const electronState = vi.hoisted(() => ({
  packaged: false,
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.packaged
    }
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler)
    })
  }
}))

vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  const autoUpdater = new EventEmitter() as InstanceType<typeof EventEmitter> & Record<string, unknown>
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = true
  autoUpdater.checkForUpdates = vi.fn(async () => undefined)
  autoUpdater.downloadUpdate = vi.fn(async () => undefined)
  autoUpdater.quitAndInstall = vi.fn()
  return { autoUpdater }
})

type AutoUpdaterMock = {
  on: (event: string, listener: (...args: unknown[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
  removeAllListeners: () => void
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}

interface WindowMock {
  isDestroyed: ReturnType<typeof vi.fn>
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  }
}

function makeWindow(): WindowMock {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    }
  }
}

function info(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: '1.2.3',
    releaseDate: '2024-05-01T00:00:00.000Z',
    releaseNotes: 'Notes',
    files: [],
    path: '',
    sha512: '',
    ...overrides
  } as UpdateInfo
}

describe('auto updater', () => {
  let module: typeof import('./updater')
  let autoUpdater: AutoUpdaterMock
  let window: WindowMock

  beforeEach(async () => {
    vi.useRealTimers()
    vi.resetModules()
    electronState.packaged = false
    electronState.handlers.clear()
    const updaterModule = await import('electron-updater')
    autoUpdater = updaterModule.autoUpdater as unknown as AutoUpdaterMock
    module = await import('./updater')
    window = makeWindow()
  })

  afterEach(() => {
    module.stopAutoUpdater()
    autoUpdater.removeAllListeners()
  })

  function setup(): void {
    module.setupAutoUpdater(window as unknown as BrowserWindow)
  }

  function handler<T = unknown>(channel: string): () => T {
    return electronState.handlers.get(channel)! as () => T
  }

  function check(): Promise<{ ok: boolean; error?: string }> {
    return handler<Promise<{ ok: boolean; error?: string }>>('update:check')()
  }

  function download(): Promise<{ ok: boolean; error?: string }> {
    return handler<Promise<{ ok: boolean; error?: string }>>('update:download')()
  }

  function install(): void {
    handler('update:install')()
  }

  it('настраивает autoUpdater и регистрирует IPC', () => {
    setup()
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(autoUpdater.allowPrerelease).toBe(false)
    expect(Array.from(electronState.handlers.keys())).toEqual([
      'update:check',
      'update:download',
      'update:install'
    ])
  })

  it('не переинициализируется при повторном вызове, но меняет окно', () => {
    setup()
    const next = makeWindow()
    module.setupAutoUpdater(next as unknown as BrowserWindow)
    expect(electronState.handlers.size).toBe(3)
    autoUpdater.emit('checking-for-update')
    expect(next.webContents.send).toHaveBeenCalledWith('update:status', { state: 'checking' })
  })

  it('запрещает проверку в неупакованном приложении', async () => {
    setup()
    await expect(check()).resolves.toEqual({
      ok: false,
      error: 'Обновления доступны только в установленной версии приложения.'
    })
    await expect(download()).resolves.toEqual({
      ok: false,
      error: 'Обновления доступны только в установленной версии приложения.'
    })
  })

  it('проверяет обновления в упакованном приложении', async () => {
    electronState.packaged = true
    setup()
    await expect(check()).resolves.toEqual({ ok: true })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
  })

  it('возвращает ошибку проверки и отправляет событие', async () => {
    electronState.packaged = true
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('network down'))
    setup()
    await expect(check()).resolves.toEqual({ ok: false, error: 'network down' })
    expect(window.webContents.send).toHaveBeenCalledWith('update:error', { message: 'network down' })
  })

  it('скачивает обновление и управляет состоянием', async () => {
    electronState.packaged = true
    setup()
    const first = download()
    const second = download()
    await expect(first).resolves.toEqual({ ok: true })
    await expect(second).resolves.toEqual({ ok: false, error: 'Загрузка уже выполняется.' })
    expect(window.webContents.send).toHaveBeenCalledWith('update:status', { state: 'downloading' })

    autoUpdater.emit('update-downloaded', info())
    expect(window.webContents.send).toHaveBeenCalledWith('update:status', {
      state: 'ready',
      version: '1.2.3',
      releaseDate: '2024-05-01T00:00:00.000Z',
      releaseNotes: 'Notes'
    })

    await expect(check()).resolves.toEqual({
      ok: false,
      error: 'Обновление уже загружается или готово к установке.'
    })
    await expect(download()).resolves.toEqual({ ok: true })
    expect(window.webContents.send).toHaveBeenCalledWith('update:status', { state: 'downloading' })
    autoUpdater.emit('update-downloaded', info())
  })

  it('возвращает ошибку загрузки и сбрасывает состояние', async () => {
    electronState.packaged = true
    autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('disk full'))
    setup()
    await expect(download()).resolves.toEqual({ ok: false, error: 'disk full' })
    expect(window.webContents.send).toHaveBeenCalledWith('update:error', { message: 'disk full' })
  })

  it('устанавливает обновление только после загрузки', async () => {
    setup()
    install()
    expect(window.webContents.send).toHaveBeenCalledWith('update:error', { message: 'Обновление ещё не загружено.' })
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()

    autoUpdater.emit('update-downloaded', info())
    install()
    await new Promise((resolve) => setImmediate(resolve))
    expect(autoUpdater.quitAndInstall).toHaveBeenCalled()
  })

  it('сообщает об ошибке quitAndInstall', async () => {
    autoUpdater.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('install failed')
    })
    setup()
    autoUpdater.emit('update-downloaded', info())
    install()
    await new Promise((resolve) => setImmediate(resolve))
    expect(window.webContents.send).toHaveBeenCalledWith('update:error', { message: 'install failed' })
  })

  it('отправляет статусы и прогресс по событиям', () => {
    setup()
    autoUpdater.emit('checking-for-update')
    autoUpdater.emit('update-available', info({ releaseNotes: 'Hello' }))
    autoUpdater.emit('download-progress', { percent: 42, transferred: 10, total: 20, bytesPerSecond: 5 })
    autoUpdater.emit('update-not-available', info())
    autoUpdater.emit('update-downloaded', info())
    autoUpdater.emit('error', new Error('boom'))

    expect(window.webContents.send).toHaveBeenCalledWith('update:status', { state: 'checking' })
    expect(window.webContents.send).toHaveBeenCalledWith('update:status', {
      state: 'available',
      version: '1.2.3',
      releaseDate: '2024-05-01T00:00:00.000Z',
      releaseNotes: 'Hello'
    })
    expect(window.webContents.send).toHaveBeenCalledWith('update:progress', {
      percent: 42,
      transferred: 10,
      total: 20,
      bytesPerSecond: 5
    })
    expect(window.webContents.send).toHaveBeenCalledWith('update:status', {
      state: 'idle',
      version: '1.2.3',
      releaseDate: '2024-05-01T00:00:00.000Z',
      releaseNotes: 'Notes'
    })
    expect(window.webContents.send).toHaveBeenCalledWith('update:status', {
      state: 'ready',
      version: '1.2.3',
      releaseDate: '2024-05-01T00:00:00.000Z',
      releaseNotes: 'Notes'
    })
    expect(window.webContents.send).toHaveBeenCalledWith('update:error', { message: 'boom' })
  })

  it('объединяет массив releaseNotes и пропускает пустые', () => {
    setup()
    autoUpdater.emit('update-available', info({
      releaseNotes: [
        { version: '1.2.3', note: 'First' },
        { version: '1.2.2', note: undefined as unknown as string },
        { version: '1.2.1', note: 'Third' }
      ]
    }))
    expect(window.webContents.send).toHaveBeenCalledWith('update:status', expect.objectContaining({
      releaseNotes: 'First\nThird'
    }))

    window.webContents.send.mockClear()
    autoUpdater.emit('update-available', info({ releaseNotes: [] }))
    expect(window.webContents.send).toHaveBeenCalledWith('update:status', expect.objectContaining({
      releaseNotes: undefined
    }))
  })

  it('не отправляет события в уничтоженное окно', () => {
    setup()
    window.isDestroyed.mockReturnValue(true)
    autoUpdater.emit('checking-for-update')
    expect(window.webContents.send).not.toHaveBeenCalled()

    window.isDestroyed.mockReturnValue(false)
    window.webContents.isDestroyed.mockReturnValue(true)
    autoUpdater.emit('checking-for-update')
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('планирует периодические проверки только в упакованном приложении', async () => {
    vi.useFakeTimers()
    setup()
    await vi.advanceTimersByTimeAsync(15000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    vi.advanceTimersByTime(4 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    electronState.packaged = true
    vi.advanceTimersByTime(4 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('останавливает таймеры и игнорирует ошибки проверки по расписанию', async () => {
    electronState.packaged = true
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('scheduled failure'))
    vi.useFakeTimers()
    setup()
    await vi.advanceTimersByTimeAsync(15000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(window.webContents.send).toHaveBeenCalledWith('update:error', { message: 'scheduled failure' })

    module.stopAutoUpdater()
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
