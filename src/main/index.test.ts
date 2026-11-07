import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, type ProfileDraft, type Snippet } from '../shared/types'

function profileDraft(): ProfileDraft {
  return {
    name: 'Production',
    group: '',
    protocol: 'ssh',
    host: 'example.com',
    port: 22,
    username: 'root',
    authMethod: 'password',
    tunnels: [],
    askPassword: false,
    keepaliveInterval: 15000,
    proxyType: 'none'
  }
}

function snippetDraft(): Snippet {
  return { id: 'snippet-1', name: 'Uptime', command: 'uptime', group: '' }
}

const electron = vi.hoisted(() => {
  const windows: any[] = []
  const trays: any[] = []
  const appHandlers: Record<string, ((...args: any[]) => void)[]> = {}
  const ipcHandlers = new Map<string, (event: any, ...args: any[]) => any>()
  const ipcListeners = new Map<string, (event: any, ...args: any[]) => void>()
  const menuTemplates: any[][] = []

  class MockWebContents {
    send = vi.fn()
    isDestroyed = vi.fn(() => false)
    setWindowOpenHandler = vi.fn()
  }

  class MockBrowserWindow {
    static getAllWindows = vi.fn(() => windows)
    static fromWebContents = vi.fn((webContents: any) => {
      return windows.find((win) => win.webContents === webContents) ?? null
    })

    options: any
    webContents = new MockWebContents()
    handlers: Record<string, ((...args: any[]) => void)[]> = {}
    isDestroyed = vi.fn(() => false)
    isMinimized = vi.fn(() => false)
    isFullScreen = vi.fn(() => false)
    show = vi.fn()
    hide = vi.fn()
    focus = vi.fn()
    restore = vi.fn()
    close = vi.fn()
    setFullScreen = vi.fn()
    loadURL = vi.fn(async () => undefined)
    loadFile = vi.fn(async () => undefined)
    on = vi.fn((event: string, callback: (...args: any[]) => void) => {
      ;(this.handlers[event] ??= []).push(callback)
      return this
    })

    constructor(options: any) {
      this.options = options
      windows.push(this)
    }
  }

  class MockTray {
    icon: any
    handlers: Record<string, (...args: any[]) => void> = {}
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    on = vi.fn((event: string, callback: (...args: any[]) => void) => {
      this.handlers[event] = callback
      return this
    })

    constructor(icon: any) {
      this.icon = icon
      trays.push(this)
    }
  }

  const app = {
    isPackaged: true,
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    setAppUserModelId: vi.fn(),
    getPath: vi.fn(() => 'C:\\Users\\tester'),
    getAppPath: vi.fn(() => 'C:\\app'),
    on: vi.fn((event: string, callback: (...args: any[]) => void) => {
      ;(appHandlers[event] ??= []).push(callback)
      return app
    })
  }

  const ipcMain = {
    handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => any) => {
      ipcHandlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, listener: (event: any, ...args: any[]) => void) => {
      ipcListeners.set(channel, listener)
    })
  }

  const showOpenDialog = vi.fn(async (): Promise<any> => ({ canceled: false, filePaths: ['C:\\file'] }))
  const showSaveDialog = vi.fn(async (): Promise<any> => ({ canceled: false, filePath: 'C:\\out.json' }))
  const dialog = { showOpenDialog, showSaveDialog }

  const nativeImage = {
    createFromPath: vi.fn(() => ({
      isEmpty: vi.fn(() => false),
      resize: vi.fn(() => ({ resized: true }))
    }))
  }

  const onHeadersReceived = vi.fn()

  const electronMock = {
    app,
    BrowserWindow: MockBrowserWindow,
    clipboard: { readText: vi.fn(() => 'clip'), writeText: vi.fn() },
    dialog,
    ipcMain,
    Menu: {
      setApplicationMenu: vi.fn(),
      buildFromTemplate: vi.fn((template: any[]) => {
        menuTemplates.push(template)
        return { template }
      })
    },
    session: { defaultSession: { webRequest: { onHeadersReceived } } },
    shell: { openExternal: vi.fn(async () => undefined) },
    Tray: MockTray,
    nativeImage,
    windows,
    trays,
    appHandlers,
    ipcHandlers,
    ipcListeners,
    menuTemplates,
    onHeadersReceived
  }

  function reset(): void {
    windows.length = 0
    trays.length = 0
    menuTemplates.length = 0
    for (const key of Object.keys(appHandlers)) delete appHandlers[key]
    ipcHandlers.clear()
    ipcListeners.clear()
    app.isPackaged = true
    app.requestSingleInstanceLock.mockReturnValue(true)
    app.quit.mockClear()
    app.whenReady.mockClear()
    showOpenDialog.mockClear()
    showSaveDialog.mockClear()
    onHeadersReceived.mockClear()
    electronMock.shell.openExternal.mockClear()
    electronMock.clipboard.readText.mockClear()
    electronMock.clipboard.writeText.mockClear()
    nativeImage.createFromPath.mockClear()
    MockBrowserWindow.getAllWindows.mockClear()
    MockBrowserWindow.fromWebContents.mockClear()
  }

  return { ...electronMock, reset, MockBrowserWindow }
})

const stores = vi.hoisted(() => {
  const state = {
    profilePath: '',
    snippetPath: '',
    profileArg: null as any,
    broadcast: null as any,
    manager: null as any
  }

  const profile = {
    list: vi.fn(async () => [createProfileFixture('profile-1')]),
    create: vi.fn(async () => createProfileFixture('created')),
    update: vi.fn(async () => createProfileFixture('updated')),
    remove: vi.fn(async () => undefined),
    duplicate: vi.fn(async () => createProfileFixture('copy')),
    exportProfiles: vi.fn(async () => '{"profiles":[]}'),
    importProfiles: vi.fn(async () => undefined)
  }

  const snippet = {
    list: vi.fn(async () => [createSnippetFixture('snippet-1')]),
    save: vi.fn(async () => createSnippetFixture('saved')),
    remove: vi.fn(async () => undefined)
  }

  class ProfileStore {
    static defaultPath = vi.fn(() => 'C:\\data\\profiles.json')
    constructor(path: string) {
      state.profilePath = path
    }
    list = profile.list
    create = profile.create
    update = profile.update
    remove = profile.remove
    duplicate = profile.duplicate
    exportProfiles = profile.exportProfiles
    importProfiles = profile.importProfiles
  }

  class SnippetStore {
    static defaultPath = vi.fn(() => 'C:\\data\\snippets.json')
    constructor(path: string) {
      state.snippetPath = path
    }
    list = snippet.list
    save = snippet.save
    remove = snippet.remove
  }

  class SessionManager {
    constructor(store: any, broadcast: any) {
      state.profileArg = store
      state.broadcast = broadcast
      state.manager = this
    }
    connect = vi.fn(async () => ({ ok: true }))
    disconnect = vi.fn(async () => undefined)
    write = vi.fn()
    writeMany = vi.fn()
    resize = vi.fn()
    startStatsPolling = vi.fn()
    stopStatsPolling = vi.fn()
    startTunnel = vi.fn(async () => ({ ok: true }))
    stopTunnel = vi.fn(async () => ({ ok: true }))
    listRemote = vi.fn(async () => [])
    uploadPath = vi.fn(async () => ({ ok: true }))
    downloadPath = vi.fn(async () => ({ ok: true }))
    cancelTransfer = vi.fn(async () => undefined)
    deleteRemote = vi.fn(async () => ({ ok: true }))
    mkdirRemote = vi.fn(async () => ({ ok: true }))
    renameRemote = vi.fn(async () => ({ ok: true }))
    providePassword = vi.fn(async () => undefined)
    provideHostKey = vi.fn(async () => undefined)
    cronList = vi.fn(async () => [])
    cronSave = vi.fn(async () => ({ ok: true }))
    dispose = vi.fn()
  }

  function createProfileFixture(id: string): any {
    return {
      id,
      name: id,
      group: '',
      protocol: 'ssh',
      host: 'example.com',
      port: 22,
      username: 'root',
      authMethod: 'password',
      tunnels: [],
      askPassword: false,
      keepaliveInterval: 15000,
      proxyType: 'none',
      hasPassword: false,
      hasPassphrase: false,
      createdAt: '',
      updatedAt: ''
    }
  }

  function createSnippetFixture(id: string): any {
    return { id, name: id, command: 'uptime', group: '' }
  }

  return { state, profile, snippet, ProfileStore, SnippetStore, SessionManager }
})

const fsMock = vi.hoisted(() => ({
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => '{"profiles":[]}')
}))

const updater = vi.hoisted(() => ({
  setupAutoUpdater: vi.fn(),
  stopAutoUpdater: vi.fn()
}))

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.MockBrowserWindow,
  clipboard: electron.clipboard,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  Menu: electron.Menu,
  session: electron.session,
  shell: electron.shell,
  Tray: electron.Tray,
  nativeImage: electron.nativeImage
}))

vi.mock('node:fs', () => ({ promises: { writeFile: fsMock.writeFile, readFile: fsMock.readFile } }))
vi.mock('./profiles', () => ({ ProfileStore: stores.ProfileStore }))
vi.mock('./snippets', () => ({ SnippetStore: stores.SnippetStore }))
vi.mock('./sessions', () => ({
  SessionManager: stores.SessionManager,
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))
vi.mock('./updater', () => updater)

function emitApp(event: string, ...args: any[]): void {
  for (const handler of electron.appHandlers[event] ?? []) handler(...args)
}

function emitWindow(win: any, event: string, ...args: any[]): void {
  for (const handler of win.handlers[event] ?? []) handler(...args)
}

async function boot(options: { packaged?: boolean; rendererUrl?: string } = {}): Promise<void> {
  electron.app.isPackaged = options.packaged ?? true
  if (options.rendererUrl) {
    (process.env as Record<string, string | undefined>).ELECTRON_RENDERER_URL = options.rendererUrl
  }
  await import('./index')
  await vi.waitFor(() => expect(electron.ipcHandlers.size).toBeGreaterThan(20))
  await vi.waitFor(() => expect(electron.windows.length).toBeGreaterThan(0))
}

function handler(channel: string): (event: any, ...args: any[]) => any {
  const value = electron.ipcHandlers.get(channel)
  if (!value) throw new Error(`Нет IPC-обработчика ${channel}`)
  return value
}

function listener(channel: string): (event: any, ...args: any[]) => void {
  const value = electron.ipcListeners.get(channel)
  if (!value) throw new Error(`Нет IPC-слушателя ${channel}`)
  return value
}

describe('main/index', () => {
  beforeEach(() => {
    electron.reset()
    vi.resetModules()
    Object.defineProperty(process, 'resourcesPath', {
      value: 'C:\\resources',
      configurable: true
    })
    for (const mock of Object.values(stores.profile)) mock.mockClear()
    for (const mock of Object.values(stores.snippet)) mock.mockClear()
    fsMock.writeFile.mockClear()
    fsMock.readFile.mockClear()
    updater.setupAutoUpdater.mockClear()
    updater.stopAutoUpdater.mockClear()
    delete (process.env as Record<string, string | undefined>).ELECTRON_RENDERER_URL
  })

  afterEach(() => {
    delete (process.env as Record<string, string | undefined>).ELECTRON_RENDERER_URL
  })

  it('запускает окно, трей и жизненный цикл приложения', async () => {
    await boot()

    expect(electron.app.requestSingleInstanceLock).toHaveBeenCalled()
    expect(electron.app.setAppUserModelId).toHaveBeenCalledWith('com.sheller.app')
    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledWith(null)
    expect(stores.state.profilePath).toBe('C:\\data\\profiles.json')
    expect(stores.state.snippetPath).toBe('C:\\data\\snippets.json')
    expect(stores.state.profileArg).toBeInstanceOf(stores.ProfileStore)
    expect(stores.state.broadcast).toBeTypeOf('function')

    const win = electron.windows[0]
    expect(win.options).toMatchObject({
      width: 1320,
      height: 840,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('renderer'))
    expect(updater.setupAutoUpdater).toHaveBeenCalledWith(win)
    expect(electron.trays).toHaveLength(1)
    expect(electron.trays[0].setToolTip).toHaveBeenCalledWith('Sheller')

    emitWindow(win, 'ready-to-show')
    expect(win.show).toHaveBeenCalled()

    const closeEvent = { preventDefault: vi.fn() }
    emitWindow(win, 'close', closeEvent)
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(win.hide).toHaveBeenCalled()

    win.isMinimized.mockReturnValue(true)
    emitApp('second-instance')
    expect(win.restore).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()

    emitApp('activate')
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()

    const tray = electron.trays[0]
    tray.handlers['double-click']()
    expect(win.focus).toHaveBeenCalled()

    const menu = electron.menuTemplates[0]
    menu[0].click()
    expect(win.show).toHaveBeenCalled()
    menu[2].click()
    expect(electron.app.quit).toHaveBeenCalled()

    emitApp('before-quit')
    expect(updater.stopAutoUpdater).toHaveBeenCalled()
    expect(stores.state.manager.dispose).toHaveBeenCalled()
    emitApp('window-all-closed')
    expect(electron.app.quit).toHaveBeenCalled()
  })

  it('создаёт новое окно по activate и загружает dev URL', async () => {
    await boot({ rendererUrl: 'http://localhost:5173' })
    const win = electron.windows[0]
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')

    emitWindow(win, 'closed')
    expect(updater.setupAutoUpdater).toHaveBeenCalledTimes(1)

    emitApp('activate')
    expect(electron.windows).toHaveLength(2)
    expect(updater.setupAutoUpdater).toHaveBeenCalledTimes(2)
  })

  it('регистрирует IPC профилей и сниппетов', async () => {
    await boot()
    const event = {}
    const profile = profileDraft()
    const snippet = snippetDraft()

    stores.profile.list.mockResolvedValueOnce([profile])
    expect(await handler(IPC.profilesList)(event)).toEqual([profile])

    expect(await handler(IPC.profilesSave)(event, 'profile-1', profile)).toEqual({
      ok: true,
      profile: expect.objectContaining({ id: 'updated' })
    })
    expect(stores.profile.update).toHaveBeenCalledWith('profile-1', profile)
    expect(await handler(IPC.profilesSave)(event, null, profile)).toEqual({
      ok: true,
      profile: expect.objectContaining({ id: 'created' })
    })
    expect(stores.profile.create).toHaveBeenCalledWith(profile)

    stores.profile.update.mockRejectedValueOnce(new Error('Диск переполнен'))
    expect(await handler(IPC.profilesSave)(event, 'profile-1', profile)).toEqual({
      ok: false,
      error: 'Диск переполнен'
    })

    expect(await handler(IPC.profilesRemove)(event, 'profile-1')).toEqual({ ok: true })
    expect(await handler(IPC.profilesRemove)(event, 42)).toEqual({ ok: false, error: 'Неверный ID' })
    expect(await handler(IPC.profilesDuplicate)(event, 'profile-1')).toEqual({
      ok: true,
      profile: expect.objectContaining({ id: 'copy' })
    })
    expect(await handler(IPC.profilesDuplicate)(event, null)).toEqual({ ok: false, error: 'Неверный ID' })

    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\key'] })
    expect(await handler(IPC.profilesPickKey)(event)).toBe('C:\\key')
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await handler(IPC.profilesPickKey)(event)).toBeNull()

    stores.profile.exportProfiles.mockResolvedValueOnce('{}')
    expect(await handler(IPC.profilesExport)(event)).toEqual({ ok: true })
    expect(fsMock.writeFile).toHaveBeenCalledWith('C:\\out.json', '{}', 'utf8')
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await handler(IPC.profilesExport)(event)).toEqual({ ok: false, error: 'Отменено' })
    stores.profile.exportProfiles.mockRejectedValueOnce(new Error('нет доступа'))
    expect(await handler(IPC.profilesExport)(event)).toEqual({ ok: false, error: 'нет доступа' })

    stores.snippet.list.mockResolvedValueOnce([snippet])
    expect(await handler(IPC.snippetsList)(event)).toEqual([snippet])
    expect(await handler(IPC.snippetsSave)(event, snippet)).toEqual({
      ok: true,
      snippet: expect.objectContaining({ id: 'saved' })
    })
    stores.snippet.save.mockRejectedValueOnce(new Error('сбой'))
    expect(await handler(IPC.snippetsSave)(event, snippet)).toEqual({ ok: false, error: 'сбой' })
    expect(await handler(IPC.snippetsRemove)(event, 'snippet-1')).toEqual({ ok: true })
    expect(await handler(IPC.snippetsRemove)(event, null)).toEqual({ ok: false, error: 'Неверный ID' })

    expect(await handler(IPC.cronList)(event, 'session-1')).toEqual([])
    await expect(handler(IPC.cronList)(event, 1)).rejects.toThrow('Неверный ID сессии')
    expect(await handler(IPC.cronSave)(event, 'session-1', [])).toEqual({ ok: true })
    expect(await handler(IPC.cronSave)(event, null, [])).toEqual({
      ok: false,
      error: 'Неверный запрос'
    })
  })

  it('регистрирует IPC импорта и файловых операций', async () => {
    await boot()
    const event = {}

    stores.profile.importProfiles.mockClear()
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\in.json'] })
    expect(await handler(IPC.profilesImport)(event)).toEqual({ ok: true })
    expect(fsMock.readFile).toHaveBeenCalledWith('C:\\in.json', 'utf8')
    expect(stores.profile.importProfiles).toHaveBeenCalledWith('{"profiles":[]}')
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await handler(IPC.profilesImport)(event)).toEqual({ ok: false, error: 'Отменено' })
    fsMock.readFile.mockRejectedValueOnce(new Error('нет файла'))
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\missing'] })
    expect(await handler(IPC.profilesImport)(event)).toEqual({ ok: false, error: 'нет файла' })

    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\a'] })
    expect(await handler(IPC.sessionPickUpload)(event, 'directory')).toEqual(['C:\\a'])
    expect(electron.dialog.showOpenDialog).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ properties: ['openDirectory'] })
    )
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ['C:\\a'] })
    expect(await handler(IPC.sessionPickUpload)(event, 'file')).toEqual([])

    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\dir'] })
    expect(await handler(IPC.sessionPickDownload)(event)).toBe('C:\\dir')
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await handler(IPC.sessionPickDownload)(event)).toBeNull()

    stores.state.manager.listRemote.mockResolvedValueOnce([{ name: 'a', path: '/a', isDirectory: false, size: 1 }])
    expect(await handler(IPC.sessionListRemote)(event, 'session-1', '/')).toEqual([
      expect.objectContaining({ name: 'a' })
    ])
    await expect(handler(IPC.sessionListRemote)(event, 1, '/')).rejects.toThrow('Неверный запрос')

    expect(await handler(IPC.sessionUpload)(event, 's', 'l', 'r', 't')).toEqual({ ok: true })
    expect(stores.state.manager.uploadPath).toHaveBeenCalledWith('s', 'l', 'r', 't')
    expect(await handler(IPC.sessionUpload)(event, 1, 'l', 'r', 't')).toEqual({
      ok: false,
      error: 'Неверный запрос'
    })
    expect(await handler(IPC.sessionDownload)(event, 's', 'r', 'l', 't')).toEqual({ ok: true })
    expect(await handler(IPC.sessionDownload)(event, 's', 1, 'l', 't')).toEqual({
      ok: false,
      error: 'Неверный запрос'
    })
    await handler(IPC.sessionCancelTransfer)(event, 't')
    expect(stores.state.manager.cancelTransfer).toHaveBeenCalledWith('t')
    await handler(IPC.sessionCancelTransfer)(event, null)
    expect(stores.state.manager.cancelTransfer).toHaveBeenCalledTimes(1)

    expect(await handler(IPC.sessionDeleteRemote)(event, 's', '/a')).toEqual({ ok: true })
    expect(await handler(IPC.sessionDeleteRemote)(event, null, '/a')).toEqual({
      ok: false,
      error: 'Неверный запрос'
    })
    expect(await handler(IPC.sessionMkdirRemote)(event, 's', '/a')).toEqual({ ok: true })
    expect(await handler(IPC.sessionMkdirRemote)(event, 's', 1)).toEqual({
      ok: false,
      error: 'Неверный запрос'
    })
    expect(await handler(IPC.sessionRenameRemote)(event, 's', '/a', '/b')).toEqual({ ok: true })
    expect(await handler(IPC.sessionRenameRemote)(event, 's', '/a', 1)).toEqual({
      ok: false,
      error: 'Неверный запрос'
    })
  })

  it('обрабатывает сессии, окна, туннели и буфер обмена', async () => {
    await boot()
    const win = electron.windows[0]
    const event = { sender: win.webContents }

    listener(IPC.windowSetFullscreen)(event, true)
    expect(win.setFullScreen).toHaveBeenCalledWith(true)
    listener(IPC.windowSetFullscreen)(event, 'yes')
    expect(win.setFullScreen).toHaveBeenCalledTimes(1)

    win.isFullScreen.mockReturnValue(true)
    expect(await handler(IPC.windowGetFullscreen)(event)).toBe(true)
    win.isDestroyed.mockReturnValue(true)
    expect(await handler(IPC.windowGetFullscreen)(event)).toBe(false)
    win.isDestroyed.mockReturnValue(false)

    await handler(IPC.sessionConnect)(event, { sessionId: 's', profileId: 'p' })
    expect(stores.state.manager.connect).toHaveBeenCalledWith({ sessionId: 's', profileId: 'p' })
    await handler(IPC.sessionDisconnect)(event, 's')
    expect(stores.state.manager.disconnect).toHaveBeenCalledWith('s')
    await handler(IPC.sessionDisconnect)(event, 1)
    expect(stores.state.manager.disconnect).toHaveBeenCalledTimes(1)

    listener(IPC.sessionGetStats)(event, 's')
    listener(IPC.sessionGetStats)(event, null)
    expect(stores.state.manager.startStatsPolling).toHaveBeenCalledTimes(1)
    listener(IPC.sessionStopStats)(event, 's')
    expect(stores.state.manager.stopStatsPolling).toHaveBeenCalledWith('s')

    listener(IPC.sessionWrite)(event, 's', 'ls\n')
    listener(IPC.sessionWrite)(event, 1, 'ls\n')
    expect(stores.state.manager.write).toHaveBeenCalledTimes(1)
    listener(IPC.sessionWriteMany)(event, ['s', 's2'], 'ls\n')
    listener(IPC.sessionWriteMany)(event, ['s', 1], 'ls\n')
    listener(IPC.sessionWriteMany)(event, 's', 'ls\n')
    expect(stores.state.manager.writeMany).toHaveBeenCalledTimes(1)
    expect(stores.state.manager.writeMany).toHaveBeenCalledWith(['s', 's2'], 'ls\n')
    listener(IPC.sessionResize)(event, 's', 80, 24)
    listener(IPC.sessionResize)(event, 's', '80', 24)
    expect(stores.state.manager.resize).toHaveBeenCalledTimes(1)

    expect(await handler(IPC.sessionStartTunnel)(event, 's', 't')).toEqual({ ok: true })
    expect(await handler(IPC.sessionStartTunnel)(event, 's', 1)).toEqual({
      ok: false,
      error: 'Неверный запрос'
    })
    expect(await handler(IPC.sessionStopTunnel)(event, 's', 't')).toEqual({ ok: true })
    expect(await handler(IPC.sessionStopTunnel)(event, null, 't')).toEqual({
      ok: false,
      error: 'Неверный запрос'
    })

    listener(IPC.sessionRequestPassword)(event, 's', 'secret')
    listener(IPC.sessionRequestPassword)(event, 's', 1)
    expect(stores.state.manager.providePassword).toHaveBeenCalledWith('s', 'secret')
    listener(IPC.sessionRequestHostKey)(event, 's', true)
    listener(IPC.sessionRequestHostKey)(event, 's', 'yes')
    expect(stores.state.manager.provideHostKey).toHaveBeenCalledWith('s', true)

    const clipboardEvent: any = {}
    listener(IPC.clipboardRead)(clipboardEvent)
    expect(clipboardEvent.returnValue).toBe('clip')
    listener(IPC.clipboardWrite)(event, 'text')
    listener(IPC.clipboardWrite)(event, 1)
    expect(electron.clipboard.writeText).toHaveBeenCalledWith('text')
  })

  it('создаёт и прикрепляет откреплённое окно', async () => {
    await boot()
    const event = {}
    await handler(IPC.sessionDetach)(event, 'session-1', 'profile-1')

    const detached = electron.windows[1]
    expect(detached.options).toMatchObject({ width: 1100, height: 750, show: false })
    expect(detached.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('renderer'),
      { query: { detached: 'session-1', profileId: 'profile-1' } }
    )

    emitWindow(detached, 'ready-to-show')
    expect(detached.show).toHaveBeenCalled()
    emitWindow(detached, 'enter-full-screen')
    expect(detached.webContents.send).toHaveBeenCalledWith(IPC.windowFullscreenChanged, true)
    emitWindow(detached, 'leave-full-screen')
    expect(detached.webContents.send).toHaveBeenCalledWith(IPC.windowFullscreenChanged, false)

    emitWindow(detached, 'closed')
    expect(stores.state.manager.disconnect).toHaveBeenCalledWith('session-1')

    await handler(IPC.sessionDetach)(event, 'session-2', 'profile-1')
    const attached = electron.windows[2]
    electron.windows[0].isMinimized.mockReturnValue(true)
    listener(IPC.sessionAttach)(
      { sender: attached.webContents },
      'session-2',
      'profile-1'
    )
    expect(attached._attached).toBe(true)
    expect(attached.close).toHaveBeenCalled()
    expect(electron.windows[0].restore).toHaveBeenCalled()
    expect(electron.windows[0].show).toHaveBeenCalled()
    expect(electron.windows[0].focus).toHaveBeenCalled()
    expect(electron.windows[0].webContents.send).toHaveBeenCalledWith(
      IPC.eventAttach,
      { sessionId: 'session-2', profileId: 'profile-1' }
    )
    emitWindow(attached, 'closed')
    expect(stores.state.manager.disconnect).toHaveBeenCalledTimes(1)

    listener(IPC.sessionAttach)({ sender: attached.webContents }, 1, 'profile-1')
    expect(attached.close).toHaveBeenCalledTimes(1)
  })

  it('транслирует события, ограничивает CSP и проверяет внешние ссылки', async () => {
    await boot()

    const win = electron.windows[0]
    const second = new electron.MockBrowserWindow({})
    second.webContents.isDestroyed.mockReturnValue(true)
    stores.state.broadcast('event:test', { value: 1 })
    expect(win.webContents.send).toHaveBeenCalledWith('event:test', { value: 1 })
    expect(second.webContents.send).not.toHaveBeenCalled()

    const headersHandler = electron.onHeadersReceived.mock.calls[0][0]
    const callback = vi.fn()
    headersHandler({ responseHeaders: { 'X-Test': ['1'] } }, callback)
    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'X-Test': ['1'],
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
        ]
      }
    })

    const openHandler = win.webContents.setWindowOpenHandler.mock.calls[0][0]
    expect(openHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://example.com')
    openHandler({ url: 'file:///etc/passwd' })
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1)
    openHandler({ url: 'not a url' })
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('в dev-режиме не включает CSP и использует иконку сборки', async () => {
    await boot({ packaged: false })

    expect(electron.onHeadersReceived).not.toHaveBeenCalled()
    const win = electron.windows[0]
    expect(win.options.icon).toContain('build')
    expect(win.options.icon).toContain('icon.ico')
  })
})
