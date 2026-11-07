import { vi } from 'vitest'
import type { ApiResult, ConnectionProfile, ProfileActionResult, ShellerApi, Snippet, TunnelConfig, TunnelRuntime, UpdaterApi } from '@shared/types'
import type { SessionTab } from '@renderer/types'

export function createProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: 'profile-1',
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
    proxyType: 'none',
    hasPassword: true,
    hasPassphrase: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

export function createSession(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    id: 'session-1',
    profile: createProfile(),
    status: 'connected',
    tunnels: [],
    ...overrides
  }
}

export function createTunnel(overrides: Partial<TunnelRuntime> = {}): TunnelRuntime {
  return {
    id: 'tunnel-1',
    name: 'Web',
    type: 'local',
    bindHost: '127.0.0.1',
    bindPort: 8080,
    destHost: '127.0.0.1',
    destPort: 80,
    autoStart: false,
    status: 'stopped',
    ...overrides
  }
}

export function createSnippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: 'snippet-1',
    name: 'Uptime',
    command: 'uptime',
    group: '',
    ...overrides
  }
}

export function createShellerApi(): ShellerApi {
  return {
    profiles: {
      list: vi.fn(async () => []),
      save: vi.fn(async (): Promise<ProfileActionResult> => ({ ok: true })),
      remove: vi.fn(async (): Promise<ProfileActionResult> => ({ ok: true })),
      duplicate: vi.fn(async (): Promise<ProfileActionResult> => ({ ok: true })),
      pickPrivateKey: vi.fn(async () => null),
      export: vi.fn(async () => ({ ok: true })),
      import: vi.fn(async () => ({ ok: true }))
    },
    snippets: {
      list: vi.fn(async () => []),
      save: vi.fn(async (): Promise<ApiResult> => ({ ok: true })),
      remove: vi.fn(async (): Promise<ApiResult> => ({ ok: true }))
    },
    sessions: {
      connect: vi.fn(async () => ({ ok: true })),
      disconnect: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      attach: vi.fn(() => undefined),
      write: vi.fn(() => undefined),
      writeMany: vi.fn(() => undefined),
      resize: vi.fn(() => undefined),
      startTunnel: vi.fn(async () => ({ ok: true })),
      stopTunnel: vi.fn(async () => ({ ok: true })),
      providePassword: vi.fn(async () => undefined),
      provideHostKey: vi.fn(async () => undefined),
      cronList: vi.fn(async () => []),
      cronSave: vi.fn(async (): Promise<ApiResult> => ({ ok: true })),
      startStatsPolling: vi.fn(() => undefined),
      stopStatsPolling: vi.fn(() => undefined)
    },
    events: {
      onData: vi.fn(() => () => undefined),
      onStatus: vi.fn(() => () => undefined),
      onTunnels: vi.fn(() => () => undefined),
      onTransfer: vi.fn(() => () => undefined),
      onZmodem: vi.fn(() => () => undefined),
      onHostKeyVerify: vi.fn(() => () => undefined),
      onRequestPassword: vi.fn(() => () => undefined),
      onAttach: vi.fn(() => () => undefined),
      onStats: vi.fn(() => () => undefined)
    },
    files: {
      pickUpload: vi.fn(async () => []),
      pickDownload: vi.fn(async () => null),
      listRemote: vi.fn(async () => []),
      deleteRemote: vi.fn(async () => ({ ok: true })),
      mkdirRemote: vi.fn(async () => ({ ok: true })),
      renameRemote: vi.fn(async () => ({ ok: true })),
      getPathForFile: vi.fn(() => ''),
      upload: vi.fn(async () => ({ ok: true })),
      download: vi.fn(async () => ({ ok: true })),
      cancel: vi.fn(async () => undefined)
    },
    clipboard: {
      readText: vi.fn(() => ''),
      writeText: vi.fn(() => undefined)
    },
    window: {
      isFullscreen: vi.fn(async () => false),
      setFullscreen: vi.fn(() => undefined),
      onFullscreenChange: vi.fn(() => () => undefined)
    }
  }
}

export function createUpdaterApi(): UpdaterApi {
  return {
    check: vi.fn(async () => ({ ok: true })),
    download: vi.fn(async () => ({ ok: true })),
    install: vi.fn(async () => undefined),
    onStatus: vi.fn(() => () => undefined),
    onProgress: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined)
  }
}

export function installShellerApi(api: ShellerApi = createShellerApi(), updater: UpdaterApi = createUpdaterApi()): {
  api: ShellerApi
  updater: UpdaterApi
} {
  Object.defineProperty(window, 'sheller', { value: api, configurable: true, writable: true })
  Object.defineProperty(window, 'updater', { value: updater, configurable: true, writable: true })
  return { api, updater }
}
