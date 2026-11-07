import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellerApi, UpdaterApi } from '../shared/types'
import { IPC } from '../shared/types'

const electron = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  invoke: vi.fn(async () => undefined),
  send: vi.fn(),
  sendSync: vi.fn(() => 'clipboard'),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(() => 'C:\\file.txt')
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((key: string, value: unknown) => {
      electron.exposed[key] = value
    })
  },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    sendSync: electron.sendSync,
    on: electron.on,
    removeListener: electron.removeListener
  },
  webUtils: {
    getPathForFile: electron.getPathForFile
  }
}))

await import('./index')

describe('preload bridge', () => {
  const api = electron.exposed.sheller as ShellerApi
  const updater = electron.exposed.updater as UpdaterApi

  beforeEach(() => {
    electron.invoke.mockClear()
    electron.send.mockClear()
    electron.sendSync.mockClear()
    electron.on.mockClear()
    electron.removeListener.mockClear()
    electron.getPathForFile.mockClear()
  })

  it('публикует оба API в main world', () => {
    expect(electron.exposed.sheller).toBe(api)
    expect(electron.exposed.updater).toBe(updater)
  })

  it('проксирует методы профилей', async () => {
    await api.profiles.list()
    await api.profiles.save('id', {} as never)
    await api.profiles.remove('id')
    await api.profiles.duplicate('id')
    await api.profiles.pickPrivateKey()
    await api.profiles.export()
    await api.profiles.import()

    expect(electron.invoke.mock.calls).toEqual([
      [IPC.profilesList],
      [IPC.profilesSave, 'id', {}],
      [IPC.profilesRemove, 'id'],
      [IPC.profilesDuplicate, 'id'],
      [IPC.profilesPickKey],
      [IPC.profilesExport],
      [IPC.profilesImport]
    ])
  })

  it('проксирует методы сниппетов', async () => {
    await api.snippets.list()
    await api.snippets.save({ name: 'x', command: 'y' })
    await api.snippets.remove('id')
    expect(electron.invoke.mock.calls).toEqual([
      [IPC.snippetsList],
      [IPC.snippetsSave, { name: 'x', command: 'y' }],
      [IPC.snippetsRemove, 'id']
    ])
  })

  it('проксирует методы сессий', async () => {
    const request = { sessionId: 's', profileId: 'p', cols: 80, rows: 24 }
    await api.sessions.connect(request)
    await api.sessions.disconnect('s')
    await api.sessions.detach('s', 'p')
    api.sessions.attach('s', 'p')
    api.sessions.write('s', 'data')
    api.sessions.writeMany(['s', 's2'], 'data')
    api.sessions.resize('s', 80, 24)
    await api.sessions.startTunnel('s', 't')
    await api.sessions.stopTunnel('s', 't')
    await api.sessions.providePassword('s', 'pwd')
    await api.sessions.provideHostKey('s', true)
    await api.sessions.cronList('s')
    await api.sessions.cronSave('s', [])
    api.sessions.startStatsPolling('s')
    api.sessions.stopStatsPolling('s')

    expect(electron.invoke.mock.calls).toEqual([
      [IPC.sessionConnect, request],
      [IPC.sessionDisconnect, 's'],
      [IPC.sessionDetach, 's', 'p'],
      [IPC.sessionStartTunnel, 's', 't'],
      [IPC.sessionStopTunnel, 's', 't'],
      [IPC.cronList, 's'],
      [IPC.cronSave, 's', []]
    ])
    expect(electron.send.mock.calls).toEqual([
      [IPC.sessionAttach, 's', 'p'],
      [IPC.sessionWrite, 's', 'data'],
      [IPC.sessionWriteMany, ['s', 's2'], 'data'],
      [IPC.sessionResize, 's', 80, 24],
      [IPC.sessionRequestPassword, 's', 'pwd'],
      [IPC.sessionRequestHostKey, 's', true],
      [IPC.sessionGetStats, 's'],
      [IPC.sessionStopStats, 's']
    ])
  })

  it('проксирует файловые методы и буфер обмена', async () => {
    await api.files.pickUpload('directory')
    await api.files.pickDownload()
    await api.files.listRemote('s', '/')
    await api.files.deleteRemote('s', '/x')
    await api.files.mkdirRemote('s', '/x')
    await api.files.renameRemote('s', '/a', '/b')
    api.files.getPathForFile({} as File)
    await api.files.upload('s', '/l', '/r', 't')
    await api.files.download('s', '/r', '/l', 't')
    await api.files.cancel('t')
    expect(api.clipboard.readText()).toBe('clipboard')
    api.clipboard.writeText('text')

    expect(electron.invoke.mock.calls).toEqual([
      [IPC.sessionPickUpload, 'directory'],
      [IPC.sessionPickDownload],
      [IPC.sessionListRemote, 's', '/'],
      [IPC.sessionDeleteRemote, 's', '/x'],
      [IPC.sessionMkdirRemote, 's', '/x'],
      [IPC.sessionRenameRemote, 's', '/a', '/b'],
      [IPC.sessionUpload, 's', '/l', '/r', 't'],
      [IPC.sessionDownload, 's', '/r', '/l', 't'],
      [IPC.sessionCancelTransfer, 't']
    ])
    expect(electron.getPathForFile).toHaveBeenCalledWith({})
    expect(electron.sendSync).toHaveBeenCalledWith(IPC.clipboardRead)
    expect(electron.send).toHaveBeenCalledWith(IPC.clipboardWrite, 'text')
  })

  it('проксирует методы окна и обновлений', async () => {
    await api.window.isFullscreen()
    api.window.setFullscreen(true)
    await updater.check()
    await updater.download()
    await updater.install()

    expect(electron.invoke.mock.calls).toEqual([
      [IPC.windowGetFullscreen],
      [IPC.updateCheck],
      [IPC.updateDownload],
      [IPC.updateInstall]
    ])
    expect(electron.send).toHaveBeenCalledWith(IPC.windowSetFullscreen, true)
  })

  it('подписывает и отписывает от событий сессий', () => {
    const listener = vi.fn()
    const offData = api.events.onData(listener)
    const offStatus = api.events.onStatus(listener)
    const offTunnels = api.events.onTunnels(listener)
    const offTransfer = api.events.onTransfer(listener)
    const offZmodem = api.events.onZmodem(listener)
    const offHostKey = api.events.onHostKeyVerify(listener)
    const offPassword = api.events.onRequestPassword(listener)
    const offAttach = api.events.onAttach(listener)
    const offStats = api.events.onStats(listener)

    expect(electron.on.mock.calls.map((call) => call[0])).toEqual([
      IPC.eventData,
      IPC.eventStatus,
      IPC.eventTunnels,
      IPC.eventTransfer,
      IPC.eventZmodem,
      IPC.eventHostKeyVerify,
      IPC.eventRequestPassword,
      IPC.eventAttach,
      IPC.eventStats
    ])

    const handler = electron.on.mock.calls[0][1] as (event: unknown, payload: unknown) => void
    handler({}, { sessionId: 's', data: 'hello' })
    expect(listener).toHaveBeenCalledWith({ sessionId: 's', data: 'hello' })

    offData()
    offStatus()
    offTunnels()
    offTransfer()
    offZmodem()
    offHostKey()
    offPassword()
    offAttach()
    offStats()
    expect(electron.removeListener).toHaveBeenCalledTimes(9)
  })

  it('подписывает и отписывает от событий окна и обновлений', () => {
    const listener = vi.fn()
    const offFullscreen = api.window.onFullscreenChange(listener)
    const offStatus = updater.onStatus(listener)
    const offProgress = updater.onProgress(listener)
    const offError = updater.onError(listener)

    expect(electron.on.mock.calls.map((call) => call[0])).toEqual([
      IPC.windowFullscreenChanged,
      IPC.updateStatus,
      IPC.updateProgress,
      IPC.updateError
    ])

    offFullscreen()
    offStatus()
    offProgress()
    offError()
    expect(electron.removeListener).toHaveBeenCalledTimes(4)
  })
})
