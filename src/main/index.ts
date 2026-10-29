import {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu,
  session as electronSession, shell, Tray, nativeImage,
  type OpenDialogOptions
} from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/types'
import type {
  ConnectionProfile, ProfileActionResult, ProfileDraft,
  SessionConnectRequest, Snippet
} from '../shared/types'
import { ProfileStore } from './profiles'
import { SnippetStore } from './snippets'
import { describeError, SessionManager } from './sessions'
import { setupAutoUpdater, stopAutoUpdater } from './updater'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: ProfileStore
let snippetStore: SnippetStore
let manager: SessionManager
let isQuitting = false


function getIconPath(ext: 'ico' | 'png' = 'ico'): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, `icon.${ext}`)
  }
  return join(app.getAppPath(), 'build', `icon.${ext}`)
}



function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function sendFullscreenState(win: BrowserWindow, value: boolean): void {
  if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(IPC.windowFullscreenChanged, value)
  }
}

function configureWindow(win: BrowserWindow): void {
  win.on('enter-full-screen', () => sendFullscreenState(win, true))
  win.on('leave-full-screen', () => sendFullscreenState(win, false))
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320, height: 840, minWidth: 980, minHeight: 620, show: false,
    backgroundColor: '#080b11', autoHideMenuBar: true,
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#0a0e15', symbolColor: '#93a0b8', height: 44 }
    } : {}),
    icon: getIconPath('ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  configureWindow(mainWindow)
  
  // [NEW] Обработка закрытия в трей
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function createTray() {
  // На Windows используем .ico с готовыми размерами, иначе иконка может выглядеть размытой
  const preferred: 'ico' | 'png' = process.platform === 'win32' ? 'ico' : 'png'
  let icon = nativeImage.createFromPath(getIconPath(preferred))
  if (icon.isEmpty()) icon = nativeImage.createFromPath(getIconPath(preferred === 'ico' ? 'png' : 'ico'))
  if (icon.isEmpty()) {
    console.warn(`[tray] Не удалось загрузить иконку: ${getIconPath(preferred)}`)
    return
  }

  const trayIcon = preferred === 'png' ? icon.resize({ width: 16, height: 16 }) : icon
  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Показать Sheller', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit() } }
  ])

  tray.setToolTip('Sheller')
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
      void shell.openExternal(url).catch(() => undefined)
    }
  } catch { undefined }
}

function profileError(error: unknown): ProfileActionResult {
  return { ok: false, error: describeError(error) }
}

function registerIpc(): void {
  // --- Профили ---
  ipcMain.handle(IPC.profilesList, async (): Promise<ConnectionProfile[]> => store.list())
  ipcMain.handle(IPC.profilesSave, async (_event, id: unknown, draft: ProfileDraft): Promise<ProfileActionResult> => {
    try {
      const profile = typeof id === 'string' ? await store.update(id, draft) : await store.create(draft)
      return { ok: true, profile }
    } catch (error) { return profileError(error) }
  })
  ipcMain.handle(IPC.profilesRemove, async (_event, id: unknown): Promise<ProfileActionResult> => {
    try {
      if (typeof id !== 'string') throw new Error('Неверный ID')
      await store.remove(id); return { ok: true }
    } catch (error) { return profileError(error) }
  })
  ipcMain.handle(IPC.profilesDuplicate, async (_event, id: unknown): Promise<ProfileActionResult> => {
    try {
      if (typeof id !== 'string') throw new Error('Неверный ID')
      const profile = await store.duplicate(id); return { ok: true, profile }
    } catch (error) { return profileError(error) }
  })
  ipcMain.handle(IPC.profilesPickKey, async (): Promise<string | null> => {
    const opts: OpenDialogOptions = { title: 'Выберите приватный ключ', defaultPath: join(app.getPath('home'), '.ssh'), properties: ['openFile'] }
    const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.profilesExport, async () => {
    try {
      const json = await store.exportProfiles()
      const r = mainWindow ? await dialog.showSaveDialog(mainWindow, { defaultPath: 'sheller_profiles.json' }) : await dialog.showSaveDialog({ defaultPath: 'sheller_profiles.json' })
      if (r.canceled || !r.filePath) return { ok: false, error: 'Отменено' }
      await fs.writeFile(r.filePath, json, 'utf8')
      return { ok: true }
    } catch (e) { return { ok: false, error: describeError(e) } }
  })
  ipcMain.handle(IPC.profilesImport, async () => {
    try {
      const r = mainWindow ? await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] }) : await dialog.showOpenDialog({ properties: ['openFile'] })
      if (r.canceled || r.filePaths.length === 0) return { ok: false, error: 'Отменено' }
      const json = await fs.readFile(r.filePaths[0], 'utf8')
      await store.importProfiles(json)
      return { ok: true }
    } catch (e) { return { ok: false, error: describeError(e) } }
  })

  // --- Сниппеты ---
  ipcMain.handle(IPC.snippetsList, async (): Promise<Snippet[]> => snippetStore.list())
  ipcMain.handle(IPC.snippetsSave, async (_event, data: Omit<Snippet, 'id'> & { id?: string }) => {
    try {
      const snippet = await snippetStore.save(data)
      return { ok: true, snippet }
    } catch (e) {
      return { ok: false, error: describeError(e) }
    }
  })
  ipcMain.handle(IPC.snippetsRemove, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string') throw new Error('Неверный ID')
      await snippetStore.remove(id)
      return { ok: true }
    } catch (e) { return { ok: false, error: describeError(e) } }
  })

  ipcMain.handle(IPC.cronList, async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('Неверный ID сессии')
    return manager.cronList(sessionId)
  })

  ipcMain.handle(IPC.cronSave, async (_e, sessionId: unknown, jobs: unknown) => {
    if (typeof sessionId !== 'string' || !Array.isArray(jobs)) {
      return { ok: false, error: 'Неверный запрос' }
    }
    return manager.cronSave(sessionId, jobs as any)
  })

  // --- Сессии и Окна ---
  ipcMain.on(IPC.windowSetFullscreen, (event, value: unknown) => {
    if (typeof value !== 'boolean') return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.setFullScreen(value)
  })
  ipcMain.handle(IPC.windowGetFullscreen, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return Boolean(win && !win.isDestroyed() && win.isFullScreen())
  })
  ipcMain.on(IPC.sessionGetStats, (_e, sessionId: unknown) => {
    if (typeof sessionId === 'string') void manager.startStatsPolling(sessionId)
  })
  ipcMain.on(IPC.sessionStopStats, (_e, sessionId: unknown) => {
    if (typeof sessionId === 'string') manager.stopStatsPolling(sessionId)
  })
  ipcMain.handle(IPC.sessionConnect, async (_event, request: SessionConnectRequest) => manager.connect(request))
  ipcMain.handle(IPC.sessionDisconnect, async (_event, sessionId: unknown) => {
    if (typeof sessionId === 'string') await manager.disconnect(sessionId)
  })
  ipcMain.handle(IPC.sessionDetach, async (_event, sessionId: unknown, profileId: unknown) => {
    if (typeof sessionId !== 'string' || typeof profileId !== 'string') return
    const win = new BrowserWindow({
      width: 1100, height: 750, show: false, backgroundColor: '#080b11', autoHideMenuBar: true,
      icon: getIconPath('ico'),
      ...(process.platform === 'win32' ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: { color: '#0a0e15', symbolColor: '#93a0b8', height: 44 }
      } : {}),
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    win.on('ready-to-show', () => win.show())
    configureWindow(win)
    ;(win as any)._attached = false
    win.on('closed', () => {
      if (!(win as any)._attached) void manager.disconnect(sessionId)
    })
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?detached=${sessionId}&profileId=${profileId}`)
    else void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { detached: sessionId, profileId } })
  })
  ipcMain.on(IPC.sessionAttach, (event, sessionId: string, profileId: string) => {
    if (typeof sessionId !== 'string' || typeof profileId !== 'string') return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) { ;(win as any)._attached = true; win.close() }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send(IPC.eventAttach, { sessionId, profileId })
    }
  })
  ipcMain.on(IPC.sessionWrite, (_e, id: unknown, data: unknown) => {
    if (typeof id === 'string' && typeof data === 'string') manager.write(id, data)
  })
  ipcMain.on(IPC.sessionResize, (_e, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id === 'string' && typeof cols === 'number' && typeof rows === 'number') manager.resize(id, cols, rows)
  })

  // --- Туннели ---
  ipcMain.handle(IPC.sessionStartTunnel, async (_e, sid, tid) => {
    if (typeof sid !== 'string' || typeof tid !== 'string') return { ok: false, error: 'Неверный запрос' }
    return manager.startTunnel(sid, tid)
  })
  ipcMain.handle(IPC.sessionStopTunnel, async (_e, sid, tid) => {
    if (typeof sid !== 'string' || typeof tid !== 'string') return { ok: false, error: 'Неверный запрос' }
    return manager.stopTunnel(sid, tid)
  })

  // --- Файлы (SFTP) ---
  ipcMain.handle(IPC.sessionPickUpload, async (_e, type: unknown) => {
    const isDir = type === 'directory'
    const opts: OpenDialogOptions = { properties: isDir ? ['openDirectory'] : ['openFile', 'multiSelections'] }
    const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })
ipcMain.handle(IPC.sessionPickDownload, async (): Promise<string | null> => {
    // 1. Убираем as const и явно указываем тип OpenDialogOptions
    const opts: OpenDialogOptions = { 
      title: 'Выберите папку для сохранения',
      properties: ['openDirectory', 'createDirectory'] 
    }
    
    const r = mainWindow 
      ? await dialog.showOpenDialog(mainWindow, opts) 
      : await dialog.showOpenDialog(opts)
      
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.sessionListRemote, async (_e, sid, path) => {
    if (typeof sid !== 'string' || typeof path !== 'string') throw new Error('Неверный запрос')
    return manager.listRemote(sid, path)
  })
  ipcMain.handle(IPC.sessionUpload, async (_e, sid, lp, rp, tid) => {
    if (typeof sid !== 'string' || typeof lp !== 'string' || typeof rp !== 'string' || typeof tid !== 'string') return { ok: false, error: 'Неверный запрос' }
    return manager.uploadPath(sid, lp, rp, tid)
  })
  ipcMain.handle(IPC.sessionDownload, async (_e, sid, rp, lp, tid) => {
    if (typeof sid !== 'string' || typeof rp !== 'string' || typeof lp !== 'string' || typeof tid !== 'string') return { ok: false, error: 'Неверный запрос' }
    return manager.downloadPath(sid, rp, lp, tid)
  })
  ipcMain.handle(IPC.sessionCancelTransfer, async (_e, tid) => {
    if (typeof tid === 'string') await manager.cancelTransfer(tid)
  })
  ipcMain.handle(IPC.sessionDeleteRemote, async (_e, sid, path) => {
    if (typeof sid !== 'string' || typeof path !== 'string') return { ok: false, error: 'Неверный запрос' }
    return manager.deleteRemote(sid, path)
  })
  ipcMain.handle(IPC.sessionMkdirRemote, async (_e, sid, path) => {
    if (typeof sid !== 'string' || typeof path !== 'string') return { ok: false, error: 'Неверный запрос' }
    return manager.mkdirRemote(sid, path)
  })
  ipcMain.handle(IPC.sessionRenameRemote, async (_e, sid, op, np) => {
    if (typeof sid !== 'string' || typeof op !== 'string' || typeof np !== 'string') return { ok: false, error: 'Неверный запрос' }
    return manager.renameRemote(sid, op, np)
  })

  // --- Асинхронные ответы ---
  ipcMain.on(IPC.sessionRequestPassword, (_e, sid: string, pwd: string) => {
    if (typeof sid === 'string' && typeof pwd === 'string') void manager.providePassword(sid, pwd)
  })
  ipcMain.on(IPC.sessionRequestHostKey, (_e, sid: string, accept: boolean) => {
    if (typeof sid === 'string' && typeof accept === 'boolean') void manager.provideHostKey(sid, accept)
  })

  // --- Буфер обмена ---
  ipcMain.on(IPC.clipboardRead, (event) => { event.returnValue = clipboard.readText() })
  ipcMain.on(IPC.clipboardWrite, (_e, text: unknown) => { if (typeof text === 'string') clipboard.writeText(text) })
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
    snippetStore = new SnippetStore(SnippetStore.defaultPath())
    manager = new SessionManager(store, broadcast)

    registerIpc()
    createTray() // [NEW]

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
    if (mainWindow) setupAutoUpdater(mainWindow)

    app.on('activate', () => {
      if (!mainWindow) {
        createWindow()
        if (mainWindow) setupAutoUpdater(mainWindow)
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
  stopAutoUpdater()
  manager?.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit()
})