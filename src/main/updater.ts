import { app, ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { IPC } from '../shared/types'
import type {
  ApiResult, UpdateErrorEvent, UpdateProgressEvent, UpdateStatusEvent
} from '../shared/types'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const INITIAL_CHECK_DELAY_MS = 15 * 1000

let targetWindow: BrowserWindow | null = null
let checkTimer: NodeJS.Timeout | null = null
let initialCheckTimer: NodeJS.Timeout | null = null
let initialized = false
let downloading = false
let downloaded = false

function send(channel: string, payload: unknown): void {
  if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
    targetWindow.webContents.send(channel, payload)
  }
}

function sendStatus(state: UpdateStatusEvent['state'], extra: Partial<UpdateStatusEvent> = {}): void {
  send(IPC.updateStatus, { state, ...extra } satisfies UpdateStatusEvent)
}

function sendError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  send(IPC.updateError, { message } satisfies UpdateErrorEvent)
}

function releaseNotes(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes
  if (!notes) return undefined
  if (typeof notes === 'string') return notes
  return notes.map((entry) => entry.note ?? '').filter(Boolean).join('\n') || undefined
}

function updatePayload(info: UpdateInfo): Partial<UpdateStatusEvent> {
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: releaseNotes(info)
  }
}

async function checkForUpdates(): Promise<ApiResult> {
  if (!app.isPackaged) {
    return { ok: false, error: 'Обновления доступны только в установленной версии приложения.' }
  }
  if (downloading || downloaded) {
    return { ok: false, error: 'Обновление уже загружается или готово к установке.' }
  }
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    sendError(error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function downloadUpdate(): Promise<ApiResult> {
  if (!app.isPackaged) {
    return { ok: false, error: 'Обновления доступны только в установленной версии приложения.' }
  }
  if (downloaded) return { ok: true }
  if (downloading) return { ok: false, error: 'Загрузка уже выполняется.' }
  downloading = true
  sendStatus('downloading')
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    downloading = false
    sendError(error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function installUpdate(): void {
  if (!downloaded) {
    sendError(new Error('Обновление ещё не загружено.'))
    return
  }
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall()
    } catch (error) {
      sendError(error)
    }
  })
}

function bindEvents(): void {
  autoUpdater.on('checking-for-update', () => sendStatus('checking'))
  autoUpdater.on('update-available', (info) => {
    downloading = false
    downloaded = false
    sendStatus('available', updatePayload(info))
  })
  autoUpdater.on('update-not-available', (info) => {
    downloading = false
    sendStatus('idle', updatePayload(info))
  })
  autoUpdater.on('download-progress', (progress) => {
    send(IPC.updateProgress, {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    } satisfies UpdateProgressEvent)
  })
  autoUpdater.on('update-downloaded', (info) => {
    downloading = false
    downloaded = true
    sendStatus('ready', updatePayload(info))
  })
  autoUpdater.on('error', (error) => {
    downloading = false
    downloaded = false
    sendError(error)
  })
}

function scheduleChecks(): void {
  initialCheckTimer = setTimeout(() => {
    if (app.isPackaged) void autoUpdater.checkForUpdates().catch(sendError)
  }, INITIAL_CHECK_DELAY_MS)
  initialCheckTimer.unref()

  checkTimer = setInterval(() => {
    if (app.isPackaged && !downloading && !downloaded) {
      void autoUpdater.checkForUpdates().catch(sendError)
    }
  }, CHECK_INTERVAL_MS)
  checkTimer.unref()
}

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  targetWindow = mainWindow
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  bindEvents()

  ipcMain.handle(IPC.updateCheck, () => checkForUpdates())
  ipcMain.handle(IPC.updateDownload, () => downloadUpdate())
  ipcMain.handle(IPC.updateInstall, () => installUpdate())

  scheduleChecks()
}

export function stopAutoUpdater(): void {
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer)
    initialCheckTimer = null
  }
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}
