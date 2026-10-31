export const IPC = {
  profilesList: 'profiles:list',
  profilesSave: 'profiles:save',
  profilesRemove: 'profiles:remove',
  profilesDuplicate: 'profiles:duplicate',
  profilesPickKey: 'profiles:pick-key',
  profilesExport: 'profiles:export',
  profilesImport: 'profiles:import',
  
  snippetsList: 'snippets:list',
  snippetsSave: 'snippets:save',
  snippetsRemove: 'snippets:remove',
  
  cronList: 'cron:list',
  cronSave: 'cron:save',

  sessionConnect: 'session:connect',
  sessionDisconnect: 'session:disconnect',
  sessionWrite: 'session:write',
  sessionResize: 'session:resize',
  sessionStartTunnel: 'session:start-tunnel',
  sessionStopTunnel: 'session:stop-tunnel',
  sessionDetach: 'session:detach',
  sessionAttach: 'session:attach',
  sessionRequestPassword: 'session:request-password',
  sessionRequestHostKey: 'session:request-hostkey',
  
  eventData: 'event:session-data',
  eventStatus: 'event:session-status',
  eventTunnels: 'event:session-tunnels',
  eventTransfer: 'event:session-transfer',
  eventZmodem: 'event:session-zmodem',
  eventHostKeyVerify: 'event:hostkey-verify',
  eventRequestPassword: 'event:request-password',
  eventAttach: 'event:session-attach',
  
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  
  sessionPickUpload: 'session:pick-upload',
  sessionPickDownload: 'session:pick-download',
  sessionListRemote: 'session:list-remote',
  sessionUpload: 'session:upload',
  sessionDownload: 'session:download',
  sessionCancelTransfer: 'session:cancel-transfer',
  sessionDeleteRemote: 'session:delete-remote',
  sessionMkdirRemote: 'session:mkdir-remote',
  sessionRenameRemote: 'session:rename-remote',
  
  sessionGetStats: 'session:get-stats',
  sessionStopStats: 'session:stop-stats',
  eventStats: 'event:session-stats',

  windowGetFullscreen: 'window:get-fullscreen',
  windowSetFullscreen: 'window:set-fullscreen',
  windowFullscreenChanged: 'window:fullscreen-changed',

  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateStatus: 'update:status',
  updateProgress: 'update:progress',
  updateError: 'update:error',
} as const

export type AuthMethod = 'password' | 'key' | 'agent'
export type TunnelType = 'local' | 'remote' | 'dynamic'
export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error'
export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
export type TransferDirection = 'upload' | 'download'
export type ProxyType = 'none' | 'socks5' | 'http'
export type Protocol = 'ssh' | 'mosh' | 'telnet'

export interface Snippet {
  id: string
  name: string
  command: string
  group?: string
  shortcut?: string
  quickAccess?: boolean
}


export interface SystemStats {
  cpu: number
  ram: number
  disk: number
  temp: number
  timestamp: number
}


export interface CronJob {
  id: string
  schedule: string
  command: string
}

export interface FileTransferProgressEvent {
  transferId: string
  sessionId: string
  direction: TransferDirection
  fileName: string
  remotePath: string
  bytesTransferred: number
  totalBytes: number
  done: boolean
  error?: string
}

export interface ZmodemEvent {
  sessionId: string
  type: 'download-start' | 'download-end' | 'upload-start' | 'upload-end' | 'error'
  fileName?: string
  error?: string
}

export interface RemoteFile {
  name: string
  path: string
  isDirectory: boolean
  size: number
  mtime: number
}

export interface TunnelConfig {
  id: string
  name: string
  type: TunnelType
  bindHost: string
  bindPort: number
  destHost?: string
  destPort?: number
  autoStart: boolean
}

export interface ConnectionProfile {
  id: string
  name: string
  group: string
  protocol: Protocol
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  jumpProfileId?: string
  tunnels: TunnelConfig[]
  askPassword: boolean
  keepaliveInterval: number
  proxyType: ProxyType
  proxyHost?: string
  proxyPort?: number
  proxyUsername?: string
  proxyPassword?: string
  bindAddress?: string 
  hostKey?: string
  moshClientPath?: string
  hasPassword: boolean
  hasPassphrase: boolean
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  
}

export interface ProfileDraft {
  name: string
  group: string
  protocol: Protocol
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  jumpProfileId?: string
  tunnels: TunnelConfig[]
  askPassword: boolean
  keepaliveInterval: number
  proxyType: ProxyType
  proxyHost?: string
  proxyPort?: number
  proxyUsername?: string
  proxyPassword?: string
  bindAddress?: string
  hostKey?: string
  moshClientPath?: string
  password?: string
  passphrase?: string
  clearPassword?: boolean
  clearPassphrase?: boolean
}

export interface SessionConnectRequest {
  sessionId: string
  profileId: string
  cols: number
  rows: number
  password?: string
  hostKey?: string
}

export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  message?: string
}

export interface SessionDataEvent {
  sessionId: string
  data: string
}

export interface TunnelsUpdatedEvent {
  sessionId: string
  tunnels: TunnelRuntime[]
}

export interface TunnelRuntime extends TunnelConfig {
  status: TunnelStatus
  boundHost?: string
  boundPort?: number
  message?: string
}

export interface ApiResult {
  ok: boolean
  error?: string
}

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateStatusEvent {
  state: UpdateState
  version?: string
  releaseDate?: string
  releaseNotes?: string
}

export interface UpdateProgressEvent {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateErrorEvent {
  message: string
}

export interface UpdaterApi {
  check: () => Promise<ApiResult>
  download: () => Promise<ApiResult>
  install: () => Promise<void>
  onStatus: (listener: (event: UpdateStatusEvent) => void) => () => void
  onProgress: (listener: (event: UpdateProgressEvent) => void) => () => void
  onError: (listener: (event: UpdateErrorEvent) => void) => () => void
}

export type ProfileActionResult =
  | { ok: true; profile?: ConnectionProfile }
  | { ok: false; error: string }

export interface ShellerApi {
  profiles: {
    list: () => Promise<ConnectionProfile[]>
    save: (id: string | null, draft: ProfileDraft) => Promise<ProfileActionResult>
    remove: (id: string) => Promise<ProfileActionResult>
    duplicate: (id: string) => Promise<ProfileActionResult>
    pickPrivateKey: () => Promise<string | null>
    export: () => Promise<ApiResult>
    import: () => Promise<ApiResult>
  }
  snippets: {
    list: () => Promise<Snippet[]>
    save: (snippet: Omit<Snippet, 'id'> & { id?: string }) => Promise<ApiResult>
    remove: (id: string) => Promise<ApiResult>
  }
  sessions: {
    connect: (request: SessionConnectRequest) => Promise<ApiResult>
    disconnect: (sessionId: string) => Promise<void>
    detach: (sessionId: string, profileId: string) => Promise<void>
    attach: (sessionId: string, profileId: string) => void
    write: (sessionId: string, data: string) => void
    resize: (sessionId: string, cols: number, rows: number) => void
    startTunnel: (sessionId: string, tunnelId: string) => Promise<ApiResult>
    stopTunnel: (sessionId: string, tunnelId: string) => Promise<ApiResult>
    providePassword: (sessionId: string, password: string) => Promise<void>
    provideHostKey: (sessionId: string, accept: boolean) => Promise<void>
    
    cronList: (sessionId: string) => Promise<CronJob[]>
    cronSave: (sessionId: string, jobs: CronJob[]) => Promise<ApiResult>

    
    startStatsPolling: (sessionId: string) => void
    stopStatsPolling: (sessionId: string) => void
  }
  events: {
    onData: (listener: (event: SessionDataEvent) => void) => () => void
    onStatus: (listener: (event: SessionStatusEvent) => void) => () => void
    onTunnels: (listener: (event: TunnelsUpdatedEvent) => void) => () => void
    onTransfer: (listener: (event: FileTransferProgressEvent) => void) => () => void
    onZmodem: (listener: (event: ZmodemEvent) => void) => () => void
    onHostKeyVerify: (listener: (event: { sessionId: string; hostKey: string; previousHostKey?: string }) => void) => () => void
    onRequestPassword: (listener: (event: { sessionId: string }) => void) => () => void
    onAttach: (listener: (event: { sessionId: string; profileId: string }) => void) => () => void

    
    onStats: (listener: (event: { sessionId: string; stats: SystemStats }) => void) => () => void
  }
  files: {
    pickUpload: (type?: 'file' | 'directory') => Promise<string[]>
    pickDownload: () => Promise<string | null>
    listRemote: (sessionId: string, path: string) => Promise<RemoteFile[]>
    deleteRemote: (sessionId: string, path: string) => Promise<ApiResult>
    mkdirRemote: (sessionId: string, path: string) => Promise<ApiResult>
    renameRemote: (sessionId: string, oldPath: string, newPath: string) => Promise<ApiResult>
    getPathForFile: (file: File) => string
    upload: (sessionId: string, localPath: string, remotePath: string, transferId: string) => Promise<ApiResult>
    download: (sessionId: string, remotePath: string, localPath: string, transferId: string) => Promise<ApiResult>
    cancel: (transferId: string) => Promise<void>
  }
  clipboard: {
    readText: () => string
    writeText: (text: string) => void
  }
  
  window: {
    isFullscreen: () => Promise<boolean>
    setFullscreen: (value: boolean) => void
    onFullscreenChange: (listener: (isFullscreen: boolean) => void) => () => void
  }
}

export const AUTH_LABELS: Record<AuthMethod, string> = {
  password: 'Пароль',
  key: 'Приватный ключ',
  agent: 'SSH-агент'
}

export const TUNNEL_LABELS: Record<TunnelType, string> = {
  local: 'Локальный',
  remote: 'Удалённый',
  dynamic: 'SOCKS5'
}