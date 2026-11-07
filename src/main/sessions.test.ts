import { EventEmitter } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect as netConnect, createServer, type Server } from 'node:net'
import { createHash } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import { IPC } from '../shared/types'
import type { ConnectionProfile, TunnelConfig } from '../shared/types'
import type { ProfileStore, ResolvedProfile } from './profiles'
import { describeError, SessionManager } from './sessions'

const state = vi.hoisted(() => ({
  packaged: false,
  appPath: 'C:/app',
  home: '',
  connectMode: 'ready' as 'ready' | 'manual' | 'error' | 'keyboard',
  connectError: new Error('connect failed'),
  lastClient: null as any,
  lastTelnet: null as any,
  lastPty: null as any,
  lastSftp: null as any,
  lastForwardChannel: null as any,
  shellChannel: null as any,
  execImpl: null as null | ((command: string, callback: (error: Error | null, stream?: any) => void) => void),
  sftpImpl: null as null | ((callback: (error: Error | null, sftp?: any) => void) => void),
  forwardOutImpl: null as null | ((host: string, port: number, callback: (error: Error | null, channel?: any) => void) => void),
  forwardInImpl: null as null | ((host: string, port: number, callback: (error: Error | null, port?: number) => void) => void),
  telnetConnectImpl: null as null | ((options: unknown) => Promise<void>),
  spawnPtyImpl: null as null | ((file: string, args: string[], options: unknown) => any),
  zmodemOptions: null as any,
  zmodemConsumeError: false,
  execFileImpl: null as null | ((file: string, args: string[], options: unknown, callback: (error: Error | null, stdout?: string, stderr?: string) => void) => any),
  httpRequestImpl: null as null | ((options: unknown) => any),
  sock: null as any
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged
    },
    getAppPath: vi.fn(() => state.appPath)
  }
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => state.home
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn()
}))

vi.mock('node:http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:http')>()),
  request: vi.fn((options: unknown) => state.httpRequestImpl!(options))
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: vi.fn((file: string, args: string[], options: unknown, callback: (...values: any[]) => void) => state.execFileImpl!(file, args, options, callback))
}))

vi.mock('ssh2', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class MockClient extends Emitter {
    config: any
    keyboardAnswers: string[] | null = null
    end = vi.fn()
    destroy = vi.fn()
    unforwardIn = vi.fn()

    constructor() {
      super()
      state.lastClient = this
    }

    connect(config: unknown): void {
      this.config = config
      if (state.connectMode === 'error') {
        queueMicrotask(() => this.emit('error', state.connectError))
        return
      }
      if (state.connectMode === 'manual') return
      if (state.connectMode === 'keyboard') {
        queueMicrotask(() => {
          this.emit('keyboard-interactive', '', '', '', [{ prompt: 'Password' }], (answers: string[]) => {
            this.keyboardAnswers = answers
          })
          this.emit('ready')
        })
        return
      }
      queueMicrotask(() => this.emit('ready'))
    }

    exec(command: string, callback: (error: Error | null, stream?: any) => void): void {
      if (state.execImpl) state.execImpl(command, callback)
      else queueMicrotask(() => callback(null, makeChannel()))
    }

    shell(_options: unknown, callback: (error: Error | null, stream?: any) => void): void {
      queueMicrotask(() => callback(null, state.shellChannel ?? makeChannel()))
    }

    sftp(callback: (error: Error | null, sftp?: any) => void): void {
      if (state.sftpImpl) state.sftpImpl(callback)
      else queueMicrotask(() => callback(null, state.lastSftp ?? makeSftp()))
    }

    forwardOut(_sourceHost: string, _sourcePort: number, host: string, port: number, callback: (error: Error | null, channel?: any) => void): void {
      if (state.forwardOutImpl) state.forwardOutImpl(host, port, callback)
      else {
        state.lastForwardChannel = makeChannel()
        queueMicrotask(() => callback(null, state.lastForwardChannel))
      }
    }

    forwardIn = vi.fn((host: string, port: number, callback: (error: Error | null, port?: number) => void): void => {
      if (state.forwardInImpl) state.forwardInImpl(host, port, callback)
      else queueMicrotask(() => callback(null, port))
    })
  }
  return {
    Client: MockClient,
    createAgent: vi.fn(() => ({ agent: true }))
  }
})

vi.mock('node-pty', () => ({
  spawn: vi.fn((file: string, args: string[], options: unknown) => {
    if (state.spawnPtyImpl) return state.spawnPtyImpl(file, args, options)
    const pty = makePty()
    state.lastPty = pty
    return pty
  })
}))

vi.mock('socks', () => ({
  SocksClient: {
    createConnection: vi.fn(async () => ({ socket: state.sock ?? new PassThrough() }))
  }
}))

vi.mock('zmodem2', async () => {
  class Sentry {
    consume: ReturnType<typeof vi.fn>
    constructor(public options: any) {
      this.consume = vi.fn((data: Buffer) => {
        if (state.zmodemConsumeError) throw new Error('zmodem error')
        this.options.to_terminal?.(data)
      })
      state.zmodemOptions = options
    }
  }
  return { default: { Sentry } }
})

vi.mock('telnet-client', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class MockTelnet extends Emitter {
    connect = vi.fn(async (options: unknown) => {
      if (state.telnetConnectImpl) return state.telnetConnectImpl(options)
      return undefined
    })
    write = vi.fn()
    destroy = vi.fn()
    end = vi.fn()
    constructor() {
      super()
      state.lastTelnet = this
    }
  }
  return { Telnet: MockTelnet }
})

function makeChannel(): any {
  const channel = new PassThrough() as any
  channel.stderr = new PassThrough()
  channel.setWindow = vi.fn()
  channel.signal = vi.fn()
  channel.close = vi.fn()
  channel.write = vi.fn((data: unknown) => {
    channel.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)))
    return true
  })
  return channel
}

function makePty(): any {
  let dataListener: ((data: string) => void) | undefined
  let exitListener: ((event: { exitCode: number }) => void) | undefined
  return {
    onData: vi.fn((listener: (data: string) => void) => {
      dataListener = listener
      return { dispose: vi.fn() }
    }),
    onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
      exitListener = listener
      return { dispose: vi.fn() }
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (data: string) => dataListener?.(data),
    emitExit: (exitCode: number) => exitListener?.({ exitCode })
  }
}

function makeStats(kind: 'file' | 'dir', size = 4): any {
  return {
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
    size,
    mtime: 123
  }
}

function makeEntry(filename: string, kind: 'file' | 'dir' = 'file', size = 1): any {
  return { filename, attrs: makeStats(kind, size) }
}

function makeSftp(): any {
  const sftp = {
    realpath: vi.fn((_path: string, callback: (error: Error | null, path?: string) => void) => callback(null, '/home/user')),
    readdir: vi.fn((_path: string, callback: (error: Error | null, list?: any[]) => void) => callback(null, [])),
    stat: vi.fn((_path: string, callback: (error: Error | null, value?: any) => void) => callback(null, makeStats('file'))),
    lstat: vi.fn((_path: string, callback: (error: Error | null, value?: any) => void) => callback(null, makeStats('file'))),
    mkdir: vi.fn((_path: string, callback: (error?: Error | null) => void) => callback(null)),
    rmdir: vi.fn((_path: string, callback: (error?: Error | null) => void) => callback(null)),
    unlink: vi.fn((_path: string, callback: (error?: Error | null) => void) => callback(null)),
    rename: vi.fn((_oldPath: string, _newPath: string, callback: (error?: Error | null) => void) => callback(null)),
    createWriteStream: vi.fn(() => new PassThrough()),
    createReadStream: vi.fn(() => Readable.from([Buffer.from('remote-data')]))
  }
  state.lastSftp = sftp
  return sftp
}

function resolved(overrides: Partial<ResolvedProfile> = {}): ResolvedProfile {
  return {
    id: 'profile-1',
    name: 'Server',
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
    password: 'secret',
    ...overrides
  }
}

function publicProfile(profile: ResolvedProfile, tunnels?: TunnelConfig[]): ConnectionProfile {
  const { password: _password, passphrase: _passphrase, proxyPassword: _proxyPassword, ...rest } = profile
  return { ...rest, tunnels: tunnels ?? rest.tunnels }
}

function tunnel(overrides: Partial<TunnelConfig> = {}): TunnelConfig {
  return {
    id: 'tunnel-1',
    name: 'Tunnel',
    type: 'local',
    bindHost: '127.0.0.1',
    bindPort: 0,
    destHost: '127.0.0.1',
    destPort: 80,
    autoStart: false,
    ...overrides
  }
}

function waitForSocket(port: number): Promise<import('node:net').Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: '127.0.0.1', port })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function nextData(socket: import('node:net').Socket): Promise<Buffer> {
  return new Promise((resolve) => {
    socket.once('data', (data) => resolve(Buffer.from(data)))
  })
}

describe('describeError', () => {
  it('переводит сетевые коды', () => {
    expect(describeError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe('Сервер отклонил подключение')
    expect(describeError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe('Хост не найден')
    expect(describeError(Object.assign(new Error('x'), { code: 'EAI_AGAIN' }))).toBe('Хост не найден')
    expect(describeError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe('Истекло время ожидания подключения')
    expect(describeError(Object.assign(new Error('x'), { code: 'EHOSTUNREACH' }))).toBe('Сервер недоступен по сети')
    expect(describeError(Object.assign(new Error('x'), { code: 'ENETUNREACH' }))).toBe('Сервер недоступен по сети')
    expect(describeError(Object.assign(new Error('x'), { code: 'EADDRINUSE' }))).toBe('Порт уже занят')
  })

  it('распознаёт ошибки аутентификации и ключа', () => {
    expect(describeError(new Error('All configured authentication methods failed'))).toContain('Не удалось пройти аутентификацию')
    expect(describeError(new Error('Encrypted private OpenSSH key detected'))).toContain('защищён паролем')
  })

  it('возвращает исходное сообщение или заглушку', () => {
    expect(describeError(new Error('custom'))).toBe('custom')
    expect(describeError('string error')).toBe('string error')
    expect(describeError(new Error(''))).toBe('Неизвестная ошибка')
  })
})

describe('SessionManager', () => {
  let manager: SessionManager
  let send: ReturnType<typeof vi.fn>
  let store: {
    resolveChain: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    touch: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  let tempDir: string
  let servers: Server[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sheller-sessions-'))
    state.home = tempDir
    state.packaged = false
    state.appPath = join(tempDir, 'app')
    state.connectMode = 'ready'
    state.connectError = new Error('connect failed')
    state.lastClient = null
    state.lastTelnet = null
    state.lastPty = null
    state.lastSftp = null
    state.lastForwardChannel = null
    state.shellChannel = makeChannel()
    state.execImpl = null
    state.sftpImpl = null
    state.forwardOutImpl = null
    state.forwardInImpl = null
    state.telnetConnectImpl = null
    state.spawnPtyImpl = null
    state.zmodemOptions = null
    state.zmodemConsumeError = false
    state.execFileImpl = (_file, _args, _options, callback) => {
      const child = new EventEmitter()
      queueMicrotask(() => callback(null, 'mosh-client\n', ''))
      return child
    }
    state.httpRequestImpl = null
    state.sock = null
    const { existsSync } = await import('node:fs')
    ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)

    store = {
      resolveChain: vi.fn(async () => [resolved()]),
      list: vi.fn(async () => [publicProfile(resolved())]),
      touch: vi.fn(async () => undefined),
      update: vi.fn(async () => publicProfile(resolved()))
    }
    send = vi.fn()
    manager = new SessionManager(store as unknown as ProfileStore, send)
    servers = []
  })

  afterEach(async () => {
    manager.dispose()
    for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tempDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  function setupProfiles(profiles: ResolvedProfile[], publicProfiles?: ConnectionProfile[]): void {
    store.resolveChain.mockResolvedValue(profiles)
    store.list.mockResolvedValue(publicProfiles ?? profiles.map((profile) => publicProfile(profile)))
  }

  function events(channel: string): any[] {
    return send.mock.calls.filter((call) => call[0] === channel).map((call) => call[1])
  }

  const connectRequest = (sessionId = 'session-1', profileId = 'profile-1') => ({
    sessionId,
    profileId,
    cols: 80,
    rows: 24
  })

  describe('connect', () => {
    it('отклоняет некорректный запрос и отменённую сессию', async () => {
      await expect(manager.connect({ sessionId: '', profileId: '' } as never)).resolves.toEqual({ ok: false, error: 'Некорректный запрос' })
      await manager.disconnect('cancelled')
      await expect(manager.connect(connectRequest('cancelled'))).resolves.toEqual({ ok: false, error: 'Соединение отменено' })
    })

    it('возвращает ошибку цепочки и отсутствующего профиля', async () => {
      store.resolveChain.mockRejectedValueOnce(new Error('bad chain'))
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: false, error: 'bad chain' })

      store.list.mockResolvedValueOnce([])
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: false, error: 'Профиль не найден' })
    })

    it('подключается по SSH и возвращает существующую сессию', async () => {
      setupProfiles([resolved()])
      const first = await manager.connect(connectRequest())
      expect(first).toEqual({ ok: true })
      expect(state.lastClient.config).toMatchObject({
        username: 'root',
        password: 'secret',
        keepaliveInterval: 15000,
        tryKeyboard: true,
        host: 'example.com',
        port: 22
      })
      expect(events(IPC.eventStatus)).toEqual([
        { sessionId: 'session-1', status: 'connecting' },
        { sessionId: 'session-1', status: 'connected' }
      ])
      expect(events(IPC.eventTunnels)).toEqual([{ sessionId: 'session-1', tunnels: [] }])
      expect(store.touch).toHaveBeenCalledWith('profile-1')

      const again = await manager.connect({ ...connectRequest(), cols: 120, rows: 40 })
      expect(again).toEqual({ ok: true })
      expect(state.shellChannel.setWindow).toHaveBeenCalledWith(40, 120, 0, 0)

      state.shellChannel.write('hello')
      expect(events(IPC.eventData)).toContainEqual({ sessionId: 'session-1', data: 'hello' })

      state.shellChannel.emit('close')
      expect(events(IPC.eventStatus).at(-1)).toEqual({ sessionId: 'session-1', status: 'disconnected', message: 'Сеанс завершён' })
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: true })
    })

    it('отклоняет повторное подключение во время установки', async () => {
      setupProfiles([resolved()])
      state.connectMode = 'manual'
      const pending = manager.connect(connectRequest())
      await vi.waitFor(() => expect(state.lastClient).toBeTruthy())
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: false, error: 'Сеанс уже в процессе подключения' })
      state.lastClient.emit('ready')
      await expect(pending).resolves.toEqual({ ok: true })
    })

    it('обрабатывает ошибку подключения SSH', async () => {
      setupProfiles([resolved()])
      state.connectMode = 'error'
      state.connectError = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: false, error: 'Сервер отклонил подключение' })
      expect(events(IPC.eventStatus).at(-1)).toMatchObject({ status: 'error', message: 'Сервер отклонил подключение' })
    })

    it('запрашивает пароль и передаёт его в keyboard-interactive', async () => {
      setupProfiles([resolved({ password: undefined })])
      state.connectMode = 'keyboard'
      const pending = manager.connect(connectRequest())
      await vi.waitFor(() => expect(events(IPC.eventRequestPassword)).toHaveLength(1))
      await manager.providePassword('session-1', 'typed-password')
      await expect(pending).resolves.toEqual({ ok: true })
      expect(state.lastClient.config.password).toBe('typed-password')
      expect(state.lastClient.keyboardAnswers).toEqual(['typed-password'])

      setupProfiles([resolved({ password: undefined })])
      state.shellChannel = makeChannel()
      const second = manager.connect(connectRequest('session-2'))
      await vi.waitFor(() => expect(events(IPC.eventRequestPassword)).toHaveLength(2))
      await manager.providePassword('session-2', 'another')
      await expect(second).resolves.toEqual({ ok: true })
      expect(state.lastClient.keyboardAnswers).toEqual(['another'])
    })

    it('обрабатывает keyboard-interactive без пароля', async () => {
      setupProfiles([resolved({ password: undefined })])
      state.connectMode = 'keyboard'
      const pending = expect(manager.connect(connectRequest())).resolves.toEqual({ ok: false, error: 'Соединение отменено' })
      await vi.waitFor(() => expect(events(IPC.eventRequestPassword)).toHaveLength(1))
      await manager.disconnect('session-1')
      await pending
    })

    it('читает приватный ключ и передаёт passphrase', async () => {
      const keyPath = join(tempDir, 'id_ed25519')
      await writeFile(keyPath, 'private-key', 'utf8')
      setupProfiles([resolved({ authMethod: 'key', privateKeyPath: keyPath, passphrase: 'phrase', password: undefined })])
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: true })
      expect(state.lastClient.config.privateKey).toEqual(Buffer.from('private-key'))
      expect(state.lastClient.config.passphrase).toBe('phrase')
    })

    it('использует SSH-агент', async () => {
      setupProfiles([resolved({ authMethod: 'agent', password: undefined })])
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: true })
      expect(state.lastClient.config.agent).toEqual({ agent: true })
    })

    it('обрабатывает подтверждение нового host key', async () => {
      setupProfiles([resolved({ hostKey: undefined })])
      state.connectMode = 'manual'
      const pending = manager.connect(connectRequest())
      await vi.waitFor(() => expect(state.lastClient).toBeTruthy())
      const verify = vi.fn()
      state.lastClient.config.hostVerifier(Buffer.from('host-key'), verify)
      expect(events(IPC.eventHostKeyVerify)).toHaveLength(1)
      await manager.provideHostKey('session-1', true)
      expect(verify).toHaveBeenCalledWith(true)
      expect(store.update).toHaveBeenCalledWith('profile-1', expect.objectContaining({ hostKey: expect.stringMatching(/^SHA256:/) }))
      state.lastClient.emit('ready')
      await expect(pending).resolves.toEqual({ ok: true })
    })

    it('отклоняет host key и принимает сохранённый ключ', async () => {
      setupProfiles([resolved({ hostKey: undefined })])
      state.connectMode = 'manual'
      const pending = manager.connect(connectRequest())
      await vi.waitFor(() => expect(state.lastClient).toBeTruthy())
      const verify = vi.fn()
      state.lastClient.config.hostVerifier(Buffer.from('host-key'), verify)
      await manager.provideHostKey('session-1', false)
      expect(verify).toHaveBeenCalledWith(false)
      state.lastClient.emit('error', new Error('rejected'))
      await expect(pending).resolves.toEqual({ ok: false, error: 'rejected' })

      const savedKey = `SHA256:${createHash('sha256').update(Buffer.from('')).digest('base64').replace(/=+$/, '')}`
      setupProfiles([resolved({ hostKey: savedKey })])
      state.connectMode = 'manual'
      const previousClient = state.lastClient
      const second = manager.connect(connectRequest('session-2'))
      await vi.waitFor(() => expect(state.lastClient).not.toBe(previousClient))
      await vi.waitFor(() => expect(state.lastClient.config?.hostVerifier).toBeTruthy())
      const savedVerify = vi.fn()
      state.lastClient.config.hostVerifier(Buffer.from(''), savedVerify)
      expect(savedVerify).toHaveBeenCalledWith(true)
      state.lastClient.emit('ready')
      await expect(second).resolves.toEqual({ ok: true })
    })

    it('отклоняет host key через rejector', async () => {
      setupProfiles([resolved({ hostKey: undefined })])
      state.connectMode = 'manual'
      const pending = manager.connect(connectRequest())
      await vi.waitFor(() => expect(state.lastClient).toBeTruthy())
      const verify = vi.fn()
      state.lastClient.config.hostVerifier(Buffer.from('key'), verify)
      const rejector = (state as unknown as { hostKeyRejector?: () => void }).hostKeyRejector
      expect(rejector).toBeUndefined()
      state.lastClient.emit('error', new Error('nope'))
      await expect(pending).resolves.toEqual({ ok: false, error: 'nope' })
    })

    it('подключается через SOCKS5 и HTTP прокси', async () => {
      state.sock = new PassThrough()
      setupProfiles([resolved({ proxyType: 'socks5', proxyHost: 'proxy', proxyPort: 1080, proxyUsername: 'u', proxyPassword: 'p' })])
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: true })
      expect(state.lastClient.config.sock).toBe(state.sock)

      state.shellChannel = makeChannel()
      const request = new EventEmitter() as any
      request.end = vi.fn()
      state.httpRequestImpl = () => request
      setupProfiles([resolved({ proxyType: 'http', proxyHost: 'proxy', proxyPort: 3128, proxyUsername: 'u', proxyPassword: 'p' })])
      const pending = manager.connect(connectRequest('session-2'))
      await vi.waitFor(() => expect(request.end).toHaveBeenCalledTimes(1))
      const socket = new PassThrough()
      request.emit('connect', { statusCode: 200 }, socket)
      await expect(pending).resolves.toEqual({ ok: true })
      expect(state.lastClient.config.sock).toBe(socket)

      setupProfiles([resolved({ proxyType: 'http', proxyHost: 'proxy', proxyPort: 3128 })])
      const rejected = manager.connect(connectRequest('session-3'))
      await vi.waitFor(() => expect(request.end).toHaveBeenCalledTimes(2))
      request.emit('connect', { statusCode: 500 }, socket)
      await expect(rejected).resolves.toEqual({ ok: false, error: 'HTTP прокси отклонил соединение' })

      state.httpRequestImpl = () => {
        const failing = new EventEmitter() as any
        failing.end = vi.fn()
        queueMicrotask(() => failing.emit('error', new Error('proxy down')))
        return failing
      }
      const failed = manager.connect(connectRequest('session-4'))
      await expect(failed).resolves.toEqual({ ok: false, error: 'proxy down' })
    })

    it('подключается через jump-хост', async () => {
      const jump = resolved({ id: 'jump', name: 'Jump', host: 'jump.example.com', port: 2222 })
      const target = resolved({ id: 'target', name: 'Target', host: 'target.example.com', port: 22 })
      setupProfiles([jump, target], [publicProfile(jump), publicProfile(target)])
      store.resolveChain.mockResolvedValue([jump, target])
      store.list.mockResolvedValue([publicProfile(target)])
      await expect(manager.connect(connectRequest('session-1', 'target'))).resolves.toEqual({ ok: true })
    })

    it('подключается к Telnet и обрабатывает данные', async () => {
      setupProfiles([resolved({ id: 'telnet', protocol: 'telnet', port: 23, password: undefined })])
      await expect(manager.connect(connectRequest('session-1', 'telnet'))).resolves.toEqual({ ok: true })
      expect(state.lastTelnet.connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'example.com', port: 23 }))
      state.lastTelnet.emit('data', Buffer.from('welcome'))
      expect(events(IPC.eventData)).toContainEqual({ sessionId: 'session-1', data: 'welcome' })
      manager.write('session-1', 'ls\r')
      expect(state.lastTelnet.write).toHaveBeenCalledWith('ls\r')
      manager.resize('session-1', 100, 30)
      state.lastTelnet.emit('close')
      expect(events(IPC.eventStatus).at(-1)).toMatchObject({ status: 'disconnected', message: 'Telnet сеанс завершён' })
    })

    it('обрабатывает ошибку Telnet', async () => {
      setupProfiles([resolved({ id: 'telnet', protocol: 'telnet', port: 23, password: undefined })])
      state.telnetConnectImpl = async () => {
        throw Object.assign(new Error('nope'), { code: 'ECONNREFUSED' })
      }
      await expect(manager.connect(connectRequest('session-1', 'telnet'))).resolves.toEqual({
        ok: false,
        error: 'Telnet: Сервер отклонил подключение'
      })
    })

    it('отклоняет Telnet без пароля', async () => {
      setupProfiles([resolved({ protocol: 'telnet', port: 23, password: undefined })])
      state.lastTelnet = null
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: true })
      state.lastTelnet.emit('error', new Error('telnet error'))
      expect(events(IPC.eventStatus).at(-1)).toEqual({ sessionId: 'session-1', status: 'error', message: 'telnet error' })
    })

    it('подключается через Mosh с нативным клиентом', async () => {
      const clientPath = join(tempDir, 'mosh-client.exe')
      await writeFile(clientPath, '', 'utf8')
      const { existsSync } = await import('node:fs')
      ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true)
      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: clientPath, password: 'secret' })])

      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.write('MOSH CONNECT 60001 KEYVALUE\n'))
      }
      const pty = makePty()
      state.spawnPtyImpl = () => pty
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: true })
      expect(pty.onData).toHaveBeenCalled()
      expect(pty.onExit).toHaveBeenCalled()
      manager.write('session-1', 'mosh-input')
      expect(pty.write).toHaveBeenCalledWith('mosh-input')
      manager.resize('session-1', 90, 30)
      expect(pty.resize).toHaveBeenCalledWith(90, 30)
      pty.emitData('mosh-output')
      expect(events(IPC.eventData)).toContainEqual({ sessionId: 'session-1', data: 'mosh-output' })
      pty.emitExit(0)
      expect(events(IPC.eventStatus).at(-1)).toMatchObject({ status: 'disconnected', message: 'Mosh-сеанс завершён' })
    })

    it('подключается через Mosh из WSL', async () => {
      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: 'wsl', password: 'secret' })])
      const { existsSync } = await import('node:fs')
      ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => String(path).toLowerCase().endsWith('wsl.exe'))
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.write('MOSH CONNECT 60002 KEY\n'))
      }
      const pty = makePty()
      state.spawnPtyImpl = (file, args, options) => {
        expect(file).toContain('wsl')
        expect(args).toEqual(['-e', 'sh', '-lc', 'exec mosh-client "$1" "$2"', 'mosh-client', 'example.com', '60002'])
        expect((options as any).env.WSLENV).toContain('MOSH_KEY')
        return pty
      }
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: true })
      pty.emitExit(1)
      expect(events(IPC.eventStatus).at(-1)).toMatchObject({ status: 'error', message: 'mosh-client завершился с кодом 1' })
    })

    it('находит встроенный и системный Mosh-клиент', async () => {
      const { existsSync } = await import('node:fs')
      const bundled = join(tempDir, 'app', 'third_party', 'mosh', 'usr', 'bin', 'mosh-client.exe')
      ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => path === bundled)
      setupProfiles([resolved({ protocol: 'mosh', password: 'secret' })])
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.write('MOSH CONNECT 60003 KEY\n'))
      }
      state.spawnPtyImpl = () => makePty()
      await expect(manager.connect(connectRequest())).resolves.toEqual({ ok: true })

      const native = join(tempDir, 'native-mosh-client.exe')
      ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => path === native)
      state.shellChannel = makeChannel()
      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: native, password: 'secret' })])
      await expect(manager.connect(connectRequest('session-2'))).resolves.toEqual({ ok: true })
    })

    it('возвращает ошибки Mosh-клиента', async () => {
      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: 'missing.exe' })])
      await expect(manager.connect(connectRequest())).resolves.toEqual({
        ok: false,
        error: 'Mosh-клиент не найден: missing.exe'
      })

      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: 'wsl' })])
      const { existsSync } = await import('node:fs')
      ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => String(path).toLowerCase().endsWith('wsl.exe'))
      state.execFileImpl = (_file, _args, _options, callback) => {
        const child = new EventEmitter()
        queueMicrotask(() => callback(null, '', ''))
        return child
      }
      await expect(manager.connect(connectRequest('session-2'))).resolves.toEqual({
        ok: false,
        error: 'В WSL не найден mosh-client. Установите Mosh: sudo apt install mosh'
      })

      setupProfiles([resolved({ protocol: 'mosh' })])
      ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
      state.execFileImpl = (_file, _args, _options, callback) => {
        const child = new EventEmitter()
        queueMicrotask(() => callback(null, '', ''))
        return child
      }
      await expect(manager.connect(connectRequest('session-3'))).resolves.toEqual({
        ok: false,
        error: 'Не найден mosh-client. Переустановите Sheller, установите Mosh/WSL или укажите путь к mosh-client в настройках профиля.'
      })
    })

    it('обрабатывает ошибки mosh-server', async () => {
      const clientPath = join(tempDir, 'mosh-client.exe')
      await writeFile(clientPath, '', 'utf8')
      const { existsSync } = await import('node:fs')
      ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true)
      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: clientPath })])

      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => {
          stream.stderr.write('SHELLER_MOSH_SERVER_MISSING\n')
          stream.emit('close')
        })
      }
      await expect(manager.connect(connectRequest())).resolves.toEqual({
        ok: false,
        error: 'На сервере не установлен mosh-server. Установите пакет mosh.'
      })

      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: clientPath })])
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => {
          stream.write('unexpected output')
          stream.emit('close')
        })
      }
      await expect(manager.connect(connectRequest('session-2'))).resolves.toEqual({
        ok: false,
        error: 'mosh-server: unexpected output'
      })

      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: clientPath })])
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.emit('error', new Error('stream broken')))
      }
      await expect(manager.connect(connectRequest('session-3'))).resolves.toEqual({ ok: false, error: 'stream broken' })
    })

    it('завершает mosh-server по таймауту', async () => {
      vi.useFakeTimers()
      const clientPath = join(tempDir, 'mosh-client.exe')
      await writeFile(clientPath, '', 'utf8')
      const { existsSync } = await import('node:fs')
      ;(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true)
      setupProfiles([resolved({ protocol: 'mosh', moshClientPath: clientPath })])
      state.execImpl = (_command, callback) => callback(null, makeChannel())
      const pending = manager.connect(connectRequest())
      await vi.advanceTimersByTimeAsync(15000)
      await expect(pending).resolves.toEqual({ ok: false, error: 'mosh-server не ответил за 15 секунд' })
    })
  })

  describe('write и resize', () => {
    it('игнорирует некорректные данные и закрытые сессии', async () => {
      expect(() => manager.write('missing', 'data')).not.toThrow()
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      manager.write('session-1', '')
      expect(state.shellChannel.write).not.toHaveBeenCalled()
      manager.write('session-1', 'data')
      expect(state.shellChannel.write).toHaveBeenCalledWith('data')
    })

    it('writeMany отправляет данные в уникальные подключённые сессии', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      manager.writeMany(['session-1', 'session-1', 'missing'], 'data')
      expect(state.shellChannel.write).toHaveBeenCalledTimes(1)
      expect(state.shellChannel.write).toHaveBeenCalledWith('data')
      state.shellChannel.write.mockClear()
      manager.writeMany(['session-1'], '')
      expect(state.shellChannel.write).not.toHaveBeenCalled()
      manager.writeMany([], 'data')
      expect(state.shellChannel.write).not.toHaveBeenCalled()
    })

    it('нормализует размеры и игнорирует неизвестную сессию', async () => {
      manager.resize('missing', 10, 10)
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      manager.resize('session-1', Number.NaN, Number.NaN)
      expect(state.shellChannel.setWindow).toHaveBeenLastCalledWith(24, 80, 0, 0)
      manager.resize('session-1', 5000, 5000)
      expect(state.shellChannel.setWindow).toHaveBeenLastCalledWith(500, 1000, 0, 0)
    })
  })

  describe('tunnels', () => {
    it('возвращает ошибки запуска и остановки туннеля', async () => {
      await expect(manager.startTunnel('missing', 't')).resolves.toEqual({ ok: false, error: 'Сначала подключитесь к серверу' })
      setupProfiles([resolved({ protocol: 'telnet', port: 23 })])
      await manager.connect(connectRequest())
      await expect(manager.startTunnel('session-1', 't')).resolves.toEqual({ ok: false, error: 'Туннели доступны только для SSH и Mosh' })
      await expect(manager.stopTunnel('session-1', 't')).resolves.toEqual({ ok: false, error: 'Туннель не найден' })
      await expect(manager.stopTunnel('missing', 't')).resolves.toEqual({ ok: false, error: 'Сеанс не найден' })
    })

    it('запускает и останавливает локальный туннель', async () => {
      const config = tunnel({ bindPort: 0, destHost: 'db.local', destPort: 5432 })
      setupProfiles([resolved({ tunnels: [config] })])
      await manager.connect(connectRequest())
      await expect(manager.startTunnel('session-1', 'tunnel-1')).resolves.toEqual({ ok: true })
      const running = events(IPC.eventTunnels).at(-1).tunnels[0]
      expect(running.status).toBe('running')
      expect(running.boundPort).toBeGreaterThan(0)

      const socket = await waitForSocket(running.boundPort)
      const channel = state.lastForwardChannel
      const serverData = nextData(socket)
      channel.write('server-data')
      await expect(serverData).resolves.toEqual(Buffer.from('server-data'))
      socket.write('client-data')
      await vi.waitFor(() => expect(channel.write).toHaveBeenCalledWith(Buffer.from('client-data')))
      socket.destroy()

      await expect(manager.startTunnel('session-1', 'tunnel-1')).resolves.toEqual({ ok: true })
      await expect(manager.stopTunnel('session-1', 'tunnel-1')).resolves.toEqual({ ok: true })
      expect(events(IPC.eventTunnels).at(-1).tunnels[0].status).toBe('stopped')
    })

    it('сообщает об ошибке занятого порта и устаревшем поколении', async () => {
      const blocker = createServer()
      servers.push(blocker)
      await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
      const address = blocker.address()
      const port = typeof address === 'object' && address ? address.port : 0

      setupProfiles([resolved({ tunnels: [tunnel({ bindPort: port }), tunnel({ id: 'tunnel-2', bindPort: port })] })])
      await manager.connect(connectRequest())
      await expect(manager.startTunnel('session-1', 'tunnel-1')).resolves.toEqual({
        ok: false,
        error: 'Порт уже занят'
      })
      expect(events(IPC.eventTunnels).at(-1).tunnels[0].status).toBe('error')

      const stale = tunnel({ id: 'stale', bindPort: 0 })
      setupProfiles([resolved({ tunnels: [stale] })])
      state.shellChannel = makeChannel()
      await manager.connect(connectRequest('session-2'))
      const start = manager.startTunnel('session-2', 'stale')
      const stop = manager.stopTunnel('session-2', 'stale')
      await expect(start).resolves.toEqual({ ok: true })
      await expect(stop).resolves.toEqual({ ok: true })
    })

    it('отклоняет forwardOut при локальном туннеле', async () => {
      const config = tunnel({ bindPort: 0 })
      setupProfiles([resolved({ tunnels: [config] })])
      await manager.connect(connectRequest())
      state.forwardOutImpl = (_host, _port, callback) => callback(new Error('forward failed'))
      await manager.startTunnel('session-1', 'tunnel-1')
      const running = events(IPC.eventTunnels).at(-1).tunnels[0]
      const socket = await waitForSocket(running.boundPort)
      socket.write('data')
      await new Promise((resolve) => setTimeout(resolve, 20))
      socket.destroy()
    })

    it('запускает удалённый туннель и диспетчер соединений', async () => {
      const received: Buffer[] = []
      const destination = createServer((socket) => {
        socket.on('data', (chunk) => received.push(Buffer.from(chunk)))
      })
      servers.push(destination)
      await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve))
      const address = destination.address()
      const destPort = typeof address === 'object' && address ? address.port : 0
      const config = tunnel({ id: 'remote', type: 'remote', bindPort: 2222, destHost: '127.0.0.1', destPort })
      const badConfig = tunnel({ id: 'remote-no-dest', type: 'remote', bindPort: 2223, destHost: undefined })
      setupProfiles([resolved({ tunnels: [config, badConfig] })])
      await manager.connect(connectRequest())
      await expect(manager.startTunnel('session-1', 'remote')).resolves.toEqual({ ok: true })
      await expect(manager.startTunnel('session-1', 'remote-no-dest')).resolves.toEqual({ ok: true })
      expect(state.lastClient.forwardIn).toHaveBeenCalled()
      expect(events(IPC.eventTunnels).at(-1).tunnels[0]).toMatchObject({ status: 'running', boundPort: 2222 })

      const channel = makeChannel()
      const accept = vi.fn(() => channel)
      const reject = vi.fn()
      state.lastClient.emit('tcp connection', { destPort: 2222 }, accept, reject)
      expect(accept).toHaveBeenCalled()
      channel.write('to-destination')
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0].toString()).toBe('to-destination')
      channel.emit('close')

      const rejectChannel = vi.fn(() => makeChannel())
      state.lastClient.emit('tcp connection', { destPort: 9999 }, rejectChannel, reject)
      expect(reject).toHaveBeenCalled()

      state.lastClient.emit('tcp connection', { destPort: 2223 }, rejectChannel, reject)
      expect(reject).toHaveBeenCalledTimes(2)

      await expect(manager.stopTunnel('session-1', 'remote')).resolves.toEqual({ ok: true })
      await expect(manager.stopTunnel('session-1', 'remote-no-dest')).resolves.toEqual({ ok: true })
      expect(state.lastClient.unforwardIn).toHaveBeenCalled()
    })

    it('обрабатывает ошибку forwardIn', async () => {
      setupProfiles([resolved({ tunnels: [tunnel({ id: 'remote', type: 'remote', bindPort: 2222 })] })])
      await manager.connect(connectRequest())
      state.forwardInImpl = (_host, _port, callback) => callback(new Error('forward in failed'))
      await expect(manager.startTunnel('session-1', 'remote')).resolves.toEqual({ ok: false, error: 'forward in failed' })
      expect(events(IPC.eventTunnels).at(-1).tunnels[0].status).toBe('error')
    })

    it('обрабатывает SOCKS5-рукопожатие', async () => {
      const config = tunnel({ id: 'dynamic', type: 'dynamic', bindPort: 0 })
      setupProfiles([resolved({ tunnels: [config] })])
      await manager.connect(connectRequest())
      await manager.startTunnel('session-1', 'dynamic')
      const port = events(IPC.eventTunnels).at(-1).tunnels[0].boundPort

      const socket = await waitForSocket(port)
      socket.write(Buffer.from([5, 1, 0]))
      await expect(nextData(socket)).resolves.toEqual(Buffer.from([5, 0]))
      const request = Buffer.from([5, 1, 0, 3, 11, ...Buffer.from('example.com'), 0, 80])
      const responsePromise = nextData(socket)
      socket.write(request)
      await expect(responsePromise).resolves.toEqual(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
      expect(state.lastForwardChannel).toBeTruthy()
      socket.destroy()

      const ipv6 = await waitForSocket(port)
      ipv6.write(Buffer.from([5, 1, 0]))
      await nextData(ipv6)
      const ipv6Request = Buffer.alloc(4 + 16 + 2)
      ipv6Request[0] = 5
      ipv6Request[1] = 1
      ipv6Request[3] = 4
      ipv6Request.fill(0, 4, 20)
      ipv6Request.writeUInt16BE(443, 20)
      const ipv6Response = nextData(ipv6)
      ipv6.write(ipv6Request)
      await expect(ipv6Response).resolves.toBeTruthy()
      ipv6.destroy()
    })

    it('отклоняет некорректные SOCKS5-запросы', async () => {
      const config = tunnel({ id: 'dynamic', type: 'dynamic', bindPort: 0 })
      setupProfiles([resolved({ tunnels: [config] })])
      await manager.connect(connectRequest())
      await manager.startTunnel('session-1', 'dynamic')
      const port = events(IPC.eventTunnels).at(-1).tunnels[0].boundPort

      const badVersion = await waitForSocket(port)
      const badVersionResponse = nextData(badVersion)
      badVersion.write(Buffer.from([4, 1, 0]))
      expect((await badVersionResponse)[1]).toBe(1)
      badVersion.destroy()

      const noAuth = await waitForSocket(port)
      const noAuthResponse = nextData(noAuth)
      noAuth.write(Buffer.from([5, 1, 2]))
      await expect(noAuthResponse).resolves.toEqual(Buffer.from([5, 255]))
      noAuth.destroy()

      const badCommand = await waitForSocket(port)
      badCommand.write(Buffer.from([5, 1, 0]))
      await nextData(badCommand)
      const badCommandResponse = nextData(badCommand)
      badCommand.write(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]))
      expect((await badCommandResponse)[1]).toBe(7)
      badCommand.destroy()

      const badType = await waitForSocket(port)
      badType.write(Buffer.from([5, 1, 0]))
      await nextData(badType)
      const badTypeResponse = nextData(badType)
      badType.write(Buffer.from([5, 1, 0, 9]))
      expect((await badTypeResponse)[1]).toBe(8)
      badType.destroy()

      const zeroPort = await waitForSocket(port)
      zeroPort.write(Buffer.from([5, 1, 0]))
      await nextData(zeroPort)
      const zeroPortResponse = nextData(zeroPort)
      zeroPort.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 0]))
      expect((await zeroPortResponse)[1]).toBe(1)
      zeroPort.destroy()

      const emptyDomain = await waitForSocket(port)
      emptyDomain.write(Buffer.from([5, 1, 0]))
      await nextData(emptyDomain)
      const emptyDomainResponse = nextData(emptyDomain)
      emptyDomain.write(Buffer.from([5, 1, 0, 3, 0, 0, 80]))
      expect((await emptyDomainResponse)[1]).toBe(8)
      emptyDomain.destroy()

      const huge = await waitForSocket(port)
      const hugeResponse = nextData(huge)
      const payload = Buffer.alloc(9000)
      payload[0] = 5
      payload[1] = 255
      huge.write(payload)
      expect((await hugeResponse)[1]).toBe(1)
      huge.destroy()
    })

    it('возвращает ошибку SOCKS5 при ошибке forwardOut', async () => {
      const config = tunnel({ id: 'dynamic', type: 'dynamic', bindPort: 0 })
      setupProfiles([resolved({ tunnels: [config] })])
      await manager.connect(connectRequest())
      state.forwardOutImpl = (_host, _port, callback) => callback(new Error('socks failed'))
      await manager.startTunnel('session-1', 'dynamic')
      const port = events(IPC.eventTunnels).at(-1).tunnels[0].boundPort
      const socket = await waitForSocket(port)
      socket.write(Buffer.from([5, 1, 0]))
      await nextData(socket)
      const response = nextData(socket)
      socket.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 80]))
      expect((await response)[1]).toBe(5)
      socket.destroy()
    })
  })

  describe('cron', () => {
    it('читает и разбирает crontab', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => {
          stream.write('\r\n# comment\r\nMAILTO=root\r\n@daily /bin/backup\r\n0 * * * * echo hourly\r\ninvalid line\r\n')
          stream.emit('close', 0)
        })
      }
      await expect(manager.cronList('session-1')).resolves.toEqual([
        { id: '3', schedule: '@daily', command: '/bin/backup' },
        { id: '4', schedule: '0 * * * *', command: 'echo hourly' }
      ])
    })

    it('принимает код 1 и отклоняет прочие коды', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => {
          stream.write('no crontab')
          stream.emit('close', 1)
        })
      }
      await expect(manager.cronList('session-1')).resolves.toEqual([])
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.emit('close', 2))
      }
      await expect(manager.cronList('session-1')).rejects.toThrow('Не удалось прочитать crontab')
    })

    it('сохраняет задания, комментарии и переменные окружения', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      let captured = ''
      state.execImpl = (command, callback) => {
        captured = command
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.emit('close', 0))
      }
      await manager.cronList('session-1').catch(() => undefined)

      state.execImpl = (command, callback) => {
        captured = command
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => {
          stream.write('ok')
          stream.emit('close', 0)
        })
      }
      const result = await manager.cronSave('session-1', [
        { id: '1', schedule: '0 * * * *', command: 'echo test' }
      ])
      expect(result).toEqual({ ok: true })
      const base64 = captured.match(/printf '%s' '([^']+)'/)?.[1]
      expect(Buffer.from(base64!, 'base64').toString('utf8')).toBe('0 * * * * echo test\n')
    })

    it('сохраняет комментарии из crontab', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      state.execImpl = (command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        if (command === 'crontab -l 2>/dev/null') {
          queueMicrotask(() => {
            stream.write('# keep\nMAILTO=root\n0 * * * * old\n')
            stream.emit('close', 0)
          })
        } else {
          queueMicrotask(() => stream.emit('close', 0))
        }
      }
      await manager.cronList('session-1')
      state.execImpl = (command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        const base64 = command.match(/printf '%s' '([^']+)'/)?.[1]
        expect(Buffer.from(base64!, 'base64').toString('utf8')).toBe('# keep\nMAILTO=root\n@daily new\n')
        queueMicrotask(() => stream.emit('close', 0))
      }
      await expect(manager.cronSave('session-1', [{ id: '1', schedule: '@daily', command: 'new' }])).resolves.toEqual({ ok: true })
    })

    it('валидирует задания и ошибки записи', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      await expect(manager.cronSave('session-1', [{ id: '1', schedule: '', command: 'x' }])).resolves.toEqual({
        ok: false,
        error: 'У задания cron не заполнено расписание или команда'
      })
      await expect(manager.cronSave('session-1', [{ id: '1', schedule: '* * * * *', command: 'x\ny' }])).resolves.toEqual({
        ok: false,
        error: 'Недопустимые символы в задании cron'
      })
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => {
          stream.write('permission denied')
          stream.emit('close', 1)
        })
      }
      await expect(manager.cronSave('session-1', [{ id: '1', schedule: '* * * * *', command: 'x' }])).resolves.toEqual({
        ok: false,
        error: 'permission denied'
      })
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.emit('close', 1))
      }
      await expect(manager.cronSave('session-1', [{ id: '1', schedule: '* * * * *', command: 'x' }])).resolves.toEqual({
        ok: false,
        error: 'Не удалось сохранить crontab'
      })
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.emit('close', 0))
      }
      await expect(manager.cronSave('session-1', [])).resolves.toEqual({ ok: true })
    })

    it('не выполняет команды без SSH и завершает по таймауту', async () => {
      await expect(manager.cronList('missing')).rejects.toThrow('Нет активного SSH-соединения')
      setupProfiles([resolved({ protocol: 'telnet', port: 23 })])
      await manager.connect(connectRequest())
      await expect(manager.cronList('session-1')).rejects.toThrow('Нет активного SSH-соединения')

      setupProfiles([resolved()])
      state.shellChannel = makeChannel()
      await manager.connect(connectRequest('session-2'))
      vi.useFakeTimers()
      state.execImpl = (_command, callback) => callback(null, makeChannel())
      const pending = expect(manager.cronList('session-2')).rejects.toThrow('Timeout')
      await vi.advanceTimersByTimeAsync(5000)
      await pending
    })

    it('обрабатывает ошибки и stderr потока exec', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => {
          stream.stderr.write('stderr text')
          stream.emit('close', undefined)
        })
      }
      await expect(manager.cronList('session-1')).resolves.toEqual([])

      state.execImpl = (_command, callback) => callback(new Error('exec failed'))
      await expect(manager.cronList('session-1')).rejects.toThrow('exec failed')

      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => stream.emit('error', new Error('stream failed')))
      }
      await expect(manager.cronList('session-1')).rejects.toThrow('stream failed')
    })
  })

  describe('stats', () => {
    it('не запускает опрос для отсутствующей или telnet-сессии', async () => {
      await expect(manager.startStatsPolling('missing')).resolves.toBeUndefined()
      setupProfiles([resolved({ protocol: 'telnet', port: 23 })])
      await manager.connect(connectRequest())
      await expect(manager.startStatsPolling('session-1')).resolves.toBeUndefined()
    })

    it('опрашивает статистику и предотвращает наложение', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      vi.useFakeTimers()
      let closeStream: (() => void) | undefined
      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        closeStream = () => {
          stream.write('CPU:12.5|RAM:42.2|DISK:77|TEMP:45.0\n')
          stream.emit('close', 0)
        }
      }
      await manager.startStatsPolling('session-1')
      await manager.startStatsPolling('session-1')
      await vi.advanceTimersByTimeAsync(2000)
      expect(closeStream).toBeTruthy()
      await vi.advanceTimersByTimeAsync(2000)
      closeStream!()
      await vi.runOnlyPendingTimersAsync()
      await vi.advanceTimersByTimeAsync(2000)
      closeStream!()
      await vi.advanceTimersByTimeAsync(0)
      expect(events(IPC.eventStats).length).toBeGreaterThan(0)
      expect(events(IPC.eventStats)[0].stats).toMatchObject({ cpu: 12.5, ram: 42.2, disk: 77, temp: 45 })
      manager.stopStatsPolling('session-1')
      manager.stopStatsPolling('session-1')
    })

    it('пропускает тик при ошибке и останавливается при отключении', async () => {
      setupProfiles([resolved()])
      await manager.connect(connectRequest())
      vi.useFakeTimers()
      state.execImpl = (_command, callback) => callback(new Error('stats failed'))
      await manager.startStatsPolling('session-1')
      await vi.advanceTimersByTimeAsync(2000)
      expect(events(IPC.eventStats)).toHaveLength(0)
      manager.stopStatsPolling('session-1')

      state.execImpl = (_command, callback) => {
        const stream = makeChannel()
        callback(null, stream)
        queueMicrotask(() => {
          stream.write('invalid')
          stream.emit('close', 0)
        })
      }
      await manager.startStatsPolling('session-1')
      await vi.advanceTimersByTimeAsync(2000)
      expect(events(IPC.eventStats)).toHaveLength(0)
      manager.disconnect('session-1')
    })
  })
})
