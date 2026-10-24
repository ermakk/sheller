import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session as electronSession,
  shell,
  type OpenDialogOptions
} from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/types'
import type {
  ConnectionProfile,
  ProfileActionResult,
  ProfileDraft,
  SessionConnectRequest
} from '../shared/types'
import { ProfileStore } from './profiles'
import { describeError, SessionManager } from './sessions'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let store: ProfileStore
let manager: SessionManager

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#080b11',
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#0a0e15',
            symbolColor: '#93a0b8',
            height: 44
          }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    manager?.dispose()
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl && url.startsWith(rendererUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
      void shell.openExternal(url)
    }
  } catch {
    undefined
  }
}

function profileError(error: unknown): ProfileActionResult {
  return { ok: false, error: describeError(error) }
}

function registerIpc(): void {
  // --- Профили ---
  ipcMain.handle(IPC.profilesList, async (): Promise<ConnectionProfile[]> => store.list())

  ipcMain.handle(
    IPC.profilesSave,
    async (_event, id: unknown, draft: ProfileDraft): Promise<ProfileActionResult> => {
      try {
        const profile =
          typeof id === 'string' ? await store.update(id, draft) : await store.create(draft)
        return { ok: true, profile }
      } catch (error) {
        return profileError(error)
      }
    }
  )

  ipcMain.handle(
    IPC.profilesRemove,
    async (_event, id: unknown): Promise<ProfileActionResult> => {
      try {
        if (typeof id !== 'string') throw new Error('Некорректный идентификатор подключения')
        await store.remove(id)
        return { ok: true }
      } catch (error) {
        return profileError(error)
      }
    }
  )

  ipcMain.handle(
    IPC.profilesDuplicate,
    async (_event, id: unknown): Promise<ProfileActionResult> => {
      try {
        if (typeof id !== 'string') throw new Error('Некорректный идентификатор подключения')
        const profile = await store.duplicate(id)
        return { ok: true, profile }
      } catch (error) {
        return profileError(error)
      }
    }
  )

  ipcMain.handle(IPC.profilesPickKey, async (): Promise<string | null> => {
    const options: OpenDialogOptions = {
      title: 'Выберите приватный ключ',
      defaultPath: join(app.getPath('home'), '.ssh'),
      properties: ['openFile'],
      filters: [
        { name: 'SSH keys', extensions: ['*'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.profilesExport, async () => {
    try {
      const json = await store.exportProfiles()
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, { title: 'Экспорт профилей', defaultPath: 'sheller_profiles.json' })
        : await dialog.showSaveDialog({ title: 'Экспорт профилей', defaultPath: 'sheller_profiles.json' })
      if (result.canceled || !result.filePath) return { ok: false, error: 'Отменено' }
      await fs.writeFile(result.filePath, json, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: describeError(e) }
    }
  })

  ipcMain.handle(IPC.profilesImport, async () => {
    try {
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, { title: 'Импорт профилей', properties: ['openFile'] })
        : await dialog.showOpenDialog({ title: 'Импорт профилей', properties: ['openFile'] })
      if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'Отменено' }
      const json = await fs.readFile(result.filePaths[0], 'utf8')
      await store.importProfiles(json)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: describeError(e) }
    }
  })

  // --- Сессии и Окна ---
  ipcMain.handle(IPC.sessionConnect, async (_event, request: SessionConnectRequest) => {
    return manager.connect(request)
  })

  ipcMain.handle(IPC.sessionDisconnect, async (_event, sessionId: unknown) => {
    if (typeof sessionId === 'string') await manager.disconnect(sessionId)
  })

  ipcMain.handle(IPC.sessionDetach, async (_event, sessionId: unknown, profileId: unknown) => {
    if (typeof sessionId !== 'string' || typeof profileId !== 'string') return
    const win = new BrowserWindow({
      width: 1100,
      height: 750,
      show: false,
      backgroundColor: '#080b11',
      autoHideMenuBar: true,
      ...(process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: { color: '#0a0e15', symbolColor: '#93a0b8', height: 44 }
          }
        : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    win.on('ready-to-show', () => win.show())

    ;(win as any)._attached = false
    win.on('closed', () => {
      if (!(win as any)._attached) {
        void manager.disconnect(sessionId)
      }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(
        `${process.env.ELECTRON_RENDERER_URL}?detached=${sessionId}&profileId=${profileId}`
      )
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { detached: sessionId, profileId }
      })
    }
  })

  ipcMain.on(IPC.sessionAttach, (event, sessionId: string, profileId: string) => {
    if (typeof sessionId !== 'string' || typeof profileId !== 'string') return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      ;(win as any)._attached = true
      win.close()
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.eventAttach, { sessionId, profileId })
    }
  })

  ipcMain.on(IPC.sessionWrite, (_event, sessionId: unknown, data: unknown) => {
    if (typeof sessionId === 'string' && typeof data === 'string') {
      manager.write(sessionId, data)
    }
  })

  ipcMain.on(IPC.sessionResize, (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
    if (typeof sessionId === 'string' && typeof cols === 'number' && typeof rows === 'number') {
      manager.resize(sessionId, cols, rows)
    }
  })

  // --- Туннели ---
  ipcMain.handle(
    IPC.sessionStartTunnel,
    async (_event, sessionId: unknown, tunnelId: unknown) => {
      if (typeof sessionId !== 'string' || typeof tunnelId !== 'string') {
        return { ok: false, error: 'Некорректный запрос туннеля' }
      }
      return manager.startTunnel(sessionId, tunnelId)
    }
  )

  ipcMain.handle(
    IPC.sessionStopTunnel,
    async (_event, sessionId: unknown, tunnelId: unknown) => {
      if (typeof sessionId !== 'string' || typeof tunnelId !== 'string') {
        return { ok: false, error: 'Некорректный запрос туннеля' }
      }
      return manager.stopTunnel(sessionId, tunnelId)
    }
  )

  // --- Файлы (SFTP) ---
  ipcMain.handle(IPC.sessionPickUpload, async (_event, type: unknown): Promise<string[]> => {
    const isDirectory = type === 'directory'
    const options: OpenDialogOptions = {
      title: isDirectory ? 'Выберите папку для загрузки' : 'Выберите файлы для загрузки',
      properties: isDirectory ? ['openDirectory'] : ['openFile', 'multiSelections']
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.sessionPickDownload, async (): Promise<string | null> => {
    const options = {
      title: 'Выберите папку для сохранения',
      properties: ['openDirectory', 'createDirectory'] as const
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(
    IPC.sessionListRemote,
    async (_event, sessionId: unknown, remotePath: unknown) => {
      if (typeof sessionId !== 'string' || typeof remotePath !== 'string') {
        throw new Error('Некорректный запрос')
      }
      return manager.listRemote(sessionId, remotePath)
    }
  )

  ipcMain.handle(
    IPC.sessionUpload,
    async (_event, sessionId: unknown, localPath: unknown, remotePath: unknown, transferId: unknown) => {
      if (
        typeof sessionId !== 'string' ||
        typeof localPath !== 'string' ||
        typeof remotePath !== 'string' ||
        typeof transferId !== 'string'
      ) {
        return { ok: false, error: 'Некорректный запрос загрузки' }
      }
      return manager.uploadPath(sessionId, localPath, remotePath, transferId)
    }
  )

  ipcMain.handle(
    IPC.sessionDownload,
    async (_event, sessionId: unknown, remotePath: unknown, localPath: unknown, transferId: unknown) => {
      if (
        typeof sessionId !== 'string' ||
        typeof remotePath !== 'string' ||
        typeof localPath !== 'string' ||
        typeof transferId !== 'string'
      ) {
        return { ok: false, error: 'Некорректный запрос скачивания' }
      }
      return manager.downloadPath(sessionId, remotePath, localPath, transferId)
    }
  )

  ipcMain.handle(IPC.sessionCancelTransfer, async (_event, transferId: unknown) => {
    if (typeof transferId === 'string') await manager.cancelTransfer(transferId)
  })

  ipcMain.handle(
    IPC.sessionDeleteRemote,
    async (_event, sessionId: unknown, remotePath: unknown) => {
      if (typeof sessionId !== 'string' || typeof remotePath !== 'string') {
        return { ok: false, error: 'Некорректный запрос' }
      }
      return manager.deleteRemote(sessionId, remotePath)
    }
  )

  ipcMain.handle(
    IPC.sessionMkdirRemote,
    async (_event, sessionId: unknown, remotePath: unknown) => {
      if (typeof sessionId !== 'string' || typeof remotePath !== 'string') {
        return { ok: false, error: 'Некорректный запрос' }
      }
      return manager.mkdirRemote(sessionId, remotePath)
    }
  )

  ipcMain.handle(
    IPC.sessionRenameRemote,
    async (_event, sessionId: unknown, oldPath: unknown, newPath: unknown) => {
      if (typeof sessionId !== 'string' || typeof oldPath !== 'string' || typeof newPath !== 'string') {
        return { ok: false, error: 'Некорректный запрос' }
      }
      return manager.renameRemote(sessionId, oldPath, newPath)
    }
  )

  // --- Асинхронные ответы ---
  ipcMain.on(IPC.sessionRequestPassword, (_event, sessionId: string, password: string) => {
    if (typeof sessionId === 'string' && typeof password === 'string') {
      void manager.providePassword(sessionId, password)
    }
  })

  ipcMain.on(IPC.sessionRequestHostKey, (_event, sessionId: string, accept: boolean) => {
    if (typeof sessionId === 'string' && typeof accept === 'boolean') {
      void manager.provideHostKey(sessionId, accept)
    }
  })

  // --- Буфер обмена ---
  ipcMain.on(IPC.clipboardRead, (event) => {
    event.returnValue = clipboard.readText()
  })

  ipcMain.on(IPC.clipboardWrite, (_event, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.sheller.app')
    Menu.setApplicationMenu(null)

    store = new ProfileStore(ProfileStore.defaultPath())
    manager = new SessionManager(store, broadcast) // Обратите внимание: передаем broadcast вместо send

    registerIpc()

    if (!isDev) {
      electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
            ]
          }
        })
      })
    }

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  manager?.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})