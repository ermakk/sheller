import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper, type TcpConnectionDetails, type Stats, type FileEntry } from 'ssh2'
import { readFile, promises as fs } from 'node:fs'
import { createServer, connect as createSocket, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { SocksClient } from 'socks'
import * as http from 'node:http'
import * as net from 'node:net'
import Zmodem from 'zmodem2'
import { Telnet } from 'telnet-client'

import { 
  IPC,
  CronJob 
} from '../shared/types'
import type {
  ApiResult,
  ConnectionProfile,
  FileTransferProgressEvent,
  ProfileDraft,
  RemoteFile,
  SessionConnectRequest,
  SessionDataEvent,
  SessionStatus,
  SessionStatusEvent,
  TunnelConfig,
  TunnelRuntime,
  TunnelsUpdatedEvent,
  TunnelStatus,
  ZmodemEvent
} from '../shared/types'
import type { ProfileStore, ResolvedProfile } from './profiles'

type Send = (channel: string, payload: unknown) => void

interface ManagedSession {
  id: string
  profile: ConnectionProfile
  status: SessionStatus
  cols: number
  rows: number
  closed: boolean
  lastError?: string
  clients: Client[]
  client?: Client
  telnetConnection?: Telnet
  stream?: ClientChannel | any
  decoder: StringDecoder
  tunnels: Map<string, TunnelState>
  remoteHandler?: (details: TcpConnectionDetails, accept: () => ClientChannel, reject: () => void) => void
  zmodem?: any
  zmodemState: 'idle' | 'receiving' | 'sending'
  hostKeyResolver?: (accept: boolean) => void
  passwordResolver?: (password: string) => void
}

interface TunnelState {
  config: TunnelConfig
  status: TunnelStatus
  generation: number
  sockets: Set<Socket>
  server?: Server
  boundHost?: string
  boundPort?: number
  message?: string
}

export function describeError(error: unknown): string {
  const err = error instanceof Error ? error : new Error(String(error))
  const code = (err as NodeJS.ErrnoException).code
  const message = err.message || ''
  if (code === 'ECONNREFUSED') return 'Сервер отклонил подключение'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Хост не найден'
  if (code === 'ETIMEDOUT') return 'Истекло время ожидания подключения'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Сервер недоступен по сети'
  if (code === 'EADDRINUSE') return 'Порт уже занят'
  if (/All configured authentication methods failed/i.test(message)) {
    return 'Не удалось пройти аутентификацию. Проверьте логин, пароль, ключ или SSH-агент.'
  }
  if (/Encrypted private OpenSSH key detected/i.test(message)) {
    return 'Приватный ключ защищён паролем. Укажите парольную фразу.'
  }
  return message || 'Неизвестная ошибка'
}

export class SessionManager {
  private sessions = new Map<string, ManagedSession>()
  private cancelledSessions = new Set<string>()
  private sftpCache = new Map<string, SFTPWrapper>()
  private transferQueue: Array<() => Promise<void>> = []
  private activeTransfersCount = 0
  private cancelledTransfers = new Set<string>()
  private readonly MAX_CONCURRENT_FILES = 2

  constructor(private readonly store: ProfileStore, private readonly send: Send) {}

  async connect(request: SessionConnectRequest): Promise<ApiResult> {
    const sessionId = String(request?.sessionId ?? '')
    const profileId = String(request?.profileId ?? '')
    if (!sessionId || !profileId) return { ok: false, error: 'Некорректный запрос' }

    // Если сессия уже существует (при возврате из отдельного окна)
    const existing = this.sessions.get(sessionId)
    if (existing && !existing.closed) {
      if (existing.status === 'connected') {
        existing.cols = normalizeDimension(request.cols, existing.cols, 2, 1000)
        existing.rows = normalizeDimension(request.rows, existing.rows, 2, 500)
        if (existing.stream && existing.profile.protocol === 'ssh') {
          existing.stream.setWindow(existing.rows, existing.cols, 0, 0)
        }
        return { ok: true }
      }
      return { ok: false, error: 'Сеанс уже в процессе подключения' }
    }

    let chain: ResolvedProfile[]
    try {
      chain = await this.store.resolveChain(profileId)
    } catch (e) {
      return { ok: false, error: describeError(e) }
    }
    const target = chain[chain.length - 1]
    const publicProfile = await this.store.list().then((profiles) =>
      profiles.find((p) => p.id === profileId)
    )
    if (!publicProfile) return { ok: false, error: 'Профиль не найден' }

    const session: ManagedSession = {
      id: sessionId,
      profile: publicProfile,
      status: 'connecting',
      cols: normalizeDimension(request.cols, 80, 2, 1000),
      rows: normalizeDimension(request.rows, 24, 2, 500),
      closed: false,
      clients: [],
      decoder: new StringDecoder('utf8'),
      tunnels: new Map(),
      zmodemState: 'idle'
    }
    this.sessions.set(sessionId, session)
    this.sendStatus({ sessionId, status: 'connecting' })
    this.emitTunnels(session)

    try {
      if (publicProfile.protocol === 'telnet') {
        return await this.connectTelnet(session, target.host, target.port)
      }

      let sock: Duplex | undefined
      let targetClient: Client | undefined

      for (let i = 0; i < chain.length; i++) {
        const hop = chain[i]
        const isTarget = i === chain.length - 1
        const client = new Client()
        session.clients.push(client)

        let proxySock: Duplex | undefined
        if (!sock && hop.proxyType !== 'none' && hop.proxyHost) {
          proxySock = await this.createProxySocket(hop)
        }

        const connectConfig: ConnectConfig = {
          username: hop.username,
          readyTimeout: 30000,
          keepaliveInterval: hop.keepaliveInterval || 15000,
          keepaliveCountMax: 4,
          tryKeyboard: hop.authMethod === 'password',
          ...(sock || proxySock ? { sock: sock || proxySock } : { host: hop.host, port: hop.port }),
          hostVerifier: (key, verify) => {
            const hash = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
            const fingerprint = `SHA256:${hash}`
            if (hop.hostKey === fingerprint) { verify(true); return }
            session.hostKeyResolver = (accept) => {
              session.hostKeyResolver = undefined
              if (accept) {
                const draft: ProfileDraft = {
                  name: hop.name, group: hop.group, protocol: hop.protocol, host: hop.host, port: hop.port,
                  username: hop.username, authMethod: hop.authMethod, privateKeyPath: hop.privateKeyPath,
                  jumpProfileId: hop.jumpProfileId, tunnels: hop.tunnels, askPassword: hop.askPassword,
                  keepaliveInterval: hop.keepaliveInterval, proxyType: hop.proxyType, proxyHost: hop.proxyHost,
                  proxyPort: hop.proxyPort, proxyUsername: hop.proxyUsername, proxyPassword: hop.proxyPassword,
                  hostKey: fingerprint
                }
                void this.store.update(hop.id, draft).catch((err) => console.error('Failed to save host key:', err))
                verify(true)
              } else {
                verify(false)
              }
            }
            this.send(IPC.eventHostKeyVerify, { sessionId, hostKey: fingerprint })
          }
        }

        if (hop.authMethod === 'password') {
          let pwd = hop.password || request.password
          if (!pwd) {
            pwd = await new Promise<string>((resolve) => {
              session.passwordResolver = resolve
              this.send(IPC.eventRequestPassword, { sessionId })
            })
          }
          connectConfig.password = pwd
        } else if (hop.authMethod === 'key' && hop.privateKeyPath) {
          connectConfig.privateKey = await readFile(hop.privateKeyPath)
          if (hop.passphrase) connectConfig.passphrase = hop.passphrase
        }

        await new Promise<void>((resolve, reject) => {
          let settled = false
          client.once('ready', () => { settled = true; resolve() })
          client.once('error', (err) => { if (!settled) { settled = true; reject(err) } })
          client.connect(connectConfig)
        })

        if (!isTarget) {
          sock = await this.forwardOut(client, chain[i + 1].host, chain[i + 1].port)
        } else {
          targetClient = client
        }
      }

      if (!targetClient) throw new Error('Не удалось установить SSH-соединение')
      session.client = targetClient

      session.stream = await new Promise((res, rej) => {
        targetClient!.shell({ term: 'xterm-256color', cols: session.cols, rows: session.rows }, (err, stream) => err ? rej(err) : res(stream))
      })

      session.status = 'connected'
      this.setupStream(session, session.stream)
      this.ensureRemoteDispatcher(session)
      this.sendStatus({ sessionId, status: 'connected' })
      void this.store.touch(target.id).catch(() => {})
      void this.startAutoTunnels(session)

      return { ok: true }
    } catch (error) {
      if (session.closed) return { ok: false, error: session.lastError ?? 'Соединение отменено' }
      const msg = describeError(error)
      this.endSession(session, 'error', msg)
      return { ok: false, error: msg }
    }
  }

  private async connectTelnet(session: ManagedSession, host: string, port: number): Promise<ApiResult> {
    const conn = new Telnet()
    session.telnetConnection = conn
    
    conn.on('data', (data: Buffer) => {
      const text = session.decoder.write(data)
      if (text && !session.closed) this.send(IPC.eventData, { sessionId: session.id, data: text })
    })
    conn.on('close', () => this.endSession(session, 'disconnected', 'Telnet сеанс завершён'))
    conn.on('error', (err: Error) => this.endSession(session, 'error', describeError(err)))

    try {
      await conn.connect({
        host,
        port,
        negotiationMandatory: false,
        timeout: 10000
      })
      session.status = 'connected'
      this.sendStatus({ sessionId: session.id, status: 'connected' })
      return { ok: true }
    } catch (err) {
      throw new Error(`Telnet: ${describeError(err)}`)
    }
  }

  private async createProxySocket(profile: ResolvedProfile): Promise<Duplex> {
    if (profile.proxyType === 'socks5') {
      const info = await SocksClient.createConnection({
        proxy: { host: profile.proxyHost!, port: profile.proxyPort!, type: 5, userId: profile.proxyUsername, password: profile.proxyPassword },
        command: 'connect',
        destination: { host: profile.host, port: profile.port }
      })
      return info.socket
    } else if (profile.proxyType === 'http') {
      return new Promise((resolve, reject) => {
        const req = http.request({
          host: profile.proxyHost, port: profile.proxyPort, method: 'CONNECT',
          path: `${profile.host}:${profile.port}`,
          headers: profile.proxyUsername ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${profile.proxyUsername}:${profile.proxyPassword}`).toString('base64') } : {}
        })
        req.on('connect', (res, socket) => {
          if (res.statusCode === 200) resolve(socket)
          else reject(new Error('HTTP прокси отклонил соединение'))
        })
        req.on('error', reject)
        req.end()
      })
    }
    throw new Error('Неизвестный тип прокси')
  }

  private setupStream(session: ManagedSession, stream: ClientChannel) {
    if (Zmodem && Zmodem.Sentry) {
      session.zmodem = new Zmodem.Sentry({
        to_terminal: (octets: any) => {
          const text = session.decoder.write(Buffer.from(octets))
          if (text) this.send(IPC.eventData, { sessionId: session.id, data: text })
        },
        sender: (octets: any) => stream.write(Buffer.from(octets)),
        on_receive: (octets: any) => {
          const text = session.decoder.write(Buffer.from(octets))
          if (text) this.send(IPC.eventData, { sessionId: session.id, data: text })
        },
        on_detect: (detection: any) => {
          const zsession = detection.confirm()
          session.zmodemState = 'receiving'
          this.send(IPC.eventZmodem, { sessionId: session.id, type: 'download-start', fileName: 'ZMODEM Download' })
          zsession.on('offer', (xfer: any) => {
            const path = join(homedir(), 'Downloads', xfer.get_details().name)
            const file = require('fs').createWriteStream(path)
            xfer.accept().then(() => {})
            xfer.on('input', (payload: any) => file.write(Buffer.from(payload)))
            xfer.on('close', () => {
              file.end()
              this.send(IPC.eventZmodem, { sessionId: session.id, type: 'download-end' })
              session.zmodemState = 'idle'
            })
          })
          zsession.start()
        }
      })
    }

    stream.on('data', (data: Buffer) => {
      if (session.zmodem && session.zmodemState === 'idle') {
        try { session.zmodem.consume(data) } 
        catch { 
          const text = session.decoder.write(data)
          if (text && !session.closed) this.send(IPC.eventData, { sessionId: session.id, data: text })
        }
      } else {
        const text = session.decoder.write(data)
        if (text && !session.closed) this.send(IPC.eventData, { sessionId: session.id, data: text })
      }
    })

    stream.on('close', () => this.endSession(session, 'disconnected', 'Сеанс завершён'))
    stream.on('error', (err) => this.endSession(session, 'error', describeError(err)))
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      this.cancelledSessions.add(sessionId)
      const timer = setTimeout(() => this.cancelledSessions.delete(sessionId), 30000)
      timer.unref()
      return
    }
    this.endSession(session, 'disconnected')
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed || session.status !== 'connected') return
    if (typeof data !== 'string' || data.length === 0) return
    
    if (session.profile.protocol === 'telnet' && session.telnetConnection) {
      session.telnetConnection.write(data)
    } else if (session.stream) {
      session.stream.write(data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) return
    const nextCols = normalizeDimension(cols, session.cols, 2, 1000)
    const nextRows = normalizeDimension(rows, session.rows, 2, 500)
    session.cols = nextCols
    session.rows = nextRows
    if (session.stream && session.status === 'connected' && session.profile.protocol === 'ssh') {
      session.stream.setWindow(nextRows, nextCols, 0, 0)
    }
  }

  async startTunnel(sessionId: string, tunnelId: string): Promise<ApiResult> {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed || session.status !== 'connected') return { ok: false, error: 'Сначала подключитесь к серверу' }
    if (session.profile.protocol !== 'ssh') return { ok: false, error: 'Туннели доступны только для SSH' }
    const tunnel = session.tunnels.get(tunnelId)
    if (!tunnel) return { ok: false, error: 'Туннель не найден' }
    try { await this.startTunnelInternal(session, tunnel); return { ok: true } } 
    catch (error) { return { ok: false, error: describeError(error) } }
  }

  async stopTunnel(sessionId: string, tunnelId: string): Promise<ApiResult> {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: 'Сеанс не найден' }
    const tunnel = session.tunnels.get(tunnelId)
    if (!tunnel) return { ok: false, error: 'Туннель не найден' }
    await this.stopTunnelInternal(session, tunnel, true)
    return { ok: true }
  }

  dispose(): void {
    for (const session of this.sessions.values()) this.endSession(session, 'disconnected')
    this.sessions.clear()
  }

   // Выполнение команды через отдельный exec-канал
  private async execCommand(sessionId: string, command: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.client || session.profile.protocol !== 'ssh') {
      throw new Error('Нет активного SSH-соединения')
    }
    return new Promise((resolve, reject) => {
      session.client!.exec(command, (err, stream) => {
        if (err) return reject(err)
        let output = ''
        stream.on('data', (data: Buffer) => { output += data.toString('utf8') })
        stream.stderr.on('data', (data: Buffer) => { output += data.toString('utf8') })
        stream.on('close', () => resolve(output))
      })
    })
  }

  async cronList(sessionId: string): Promise<CronJob[]> {
    // Используем /bin/sh, чтобы base64 и crontab работали в любом окружении
    const output = await this.execCommand(sessionId, 'crontab -l 2>/dev/null || true')
    const lines = output.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    
    return lines.map((line, index) => {
      // Пытаемся выделить 5 полей расписания и команду
      const match = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/)
      if (match) {
        return { id: String(index), schedule: match[1], command: match[2] }
      }
      return { id: String(index), schedule: '* * * * *', command: line }
    })
  }

  async cronSave(sessionId: string, jobs: CronJob[]): Promise<ApiResult> {
    try {
      const content = jobs.map(j => `${j.schedule} ${j.command}`).join('\n') + '\n'
      // Кодируем в base64, чтобы избежать проблем с кавычками и спецсимволами в командах
      const base64 = Buffer.from(content, 'utf8').toString('base64')
      
      // Записываем через временный файл в /tmp, чтобы избежать проблем с pipe
      const cmd = `echo "${base64}" | base64 -d | crontab -`
      await this.execCommand(sessionId, cmd)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: describeError(e) }
    }
  }

  async uploadPath(sessionId: string, localPath: string, remoteDir: string, transferId: string): Promise<ApiResult> {
    const session = this.sessions.get(sessionId)
    if (session?.profile.protocol !== 'ssh') return { ok: false, error: 'SFTP доступен только для SSH' }
    
    const fileName = basename(localPath)
    const emit = (bytes: number, total: number, done: boolean, error?: string) => {
      this.send(IPC.eventTransfer, {
        transferId, sessionId, direction: 'upload', fileName, remotePath: remoteDir,
        bytesTransferred: bytes, totalBytes: total, done, error
      } satisfies FileTransferProgressEvent)
    }
    if (!session || session.closed || session.status !== 'connected') {
      emit(0, 0, true, 'Сначала подключитесь к серверу')
      return { ok: false, error: 'Сначала подключитесь к серверу' }
    }
    emit(0, 0, false)
    this.enqueueTransfer(async () => {
      try {
        const sftp = await this.getSftp(sessionId)
        const stats = await fs.stat(localPath)
        if (stats.isDirectory()) {
          await this.uploadDirRecursive(sftp, localPath, remoteDir, emit, transferId)
        } else {
          const remotePath = `${remoteDir}/${fileName}`.replace(/\/+/g, '/').replace(/\\/g, '/')
          await this.uploadFileInternal(sftp, localPath, remotePath, stats.size, emit, transferId)
        }
        emit(1, 1, true)
      } catch (error) {
        const msg = this.cancelledTransfers.has(transferId) ? 'Загрузка отменена' : describeError(error)
        emit(0, 0, true, msg)
      } finally {
        this.cancelledTransfers.delete(transferId)
      }
    })
    return { ok: true }
  }

  async downloadPath(sessionId: string, remotePath: string, localDir: string, transferId: string): Promise<ApiResult> {
    const session = this.sessions.get(sessionId)
    if (session?.profile.protocol !== 'ssh') return { ok: false, error: 'SFTP доступен только для SSH' }
    
    const fileName = basename(remotePath)
    const emit = (bytes: number, total: number, done: boolean, error?: string) => {
      this.send(IPC.eventTransfer, {
        transferId, sessionId, direction: 'download', fileName, remotePath,
        bytesTransferred: bytes, totalBytes: total, done, error
      } satisfies FileTransferProgressEvent)
    }
    if (!session || session.closed || session.status !== 'connected') {
      emit(0, 0, true, 'Сначала подключитесь к серверу')
      return { ok: false, error: 'Сначала подключитесь к серверу' }
    }
    emit(0, 0, false)
    this.enqueueTransfer(async () => {
      try {
        const sftp = await this.getSftp(sessionId)
        const stats = await new Promise<Stats>((res, rej) =>
          sftp.stat(remotePath, (err, st) => err ? rej(err) : res(st))
        )
        if (stats.isDirectory()) {
          const finalLocalDir = join(localDir, fileName)
          await this.downloadDirRecursive(sftp, remotePath, finalLocalDir, emit, transferId)
        } else {
          await this.downloadFileInternal(sftp, remotePath, localDir, stats.size, emit, transferId)
        }
        emit(1, 1, true)
      } catch (error) {
        const msg = this.cancelledTransfers.has(transferId) ? 'Скачивание отменено' : describeError(error)
        emit(0, 0, true, msg)
      } finally {
        this.cancelledTransfers.delete(transferId)
      }
    })
    return { ok: true }
  }

  async listRemote(sessionId: string, remotePath: string): Promise<RemoteFile[]> {
    const session = this.sessions.get(sessionId)
    if (session?.profile.protocol !== 'ssh') throw new Error('SFTP доступен только для SSH')
    if (!session || session.closed || session.status !== 'connected') throw new Error('Сначала подключитесь к серверу')
    const sftp = await this.getSftp(sessionId)
    let path = remotePath
    if (path === '~' || path === '' || path === '/~') {
      path = await new Promise<string>((res, rej) => {
        sftp.realpath('.', (err, p) => (err ? rej(err) : res(p)))
      })
    }
    const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    const list = await new Promise<FileEntry[]>((res, rej) => {
      sftp.readdir(normalized, (err, list) => (err ? rej(err) : res(list)))
    })
    return list
      .filter((item) => item.filename !== '.' && item.filename !== '..')
      .map((item) => ({
        name: item.filename,
        path: `${normalized === '/' ? '' : normalized}/${item.filename}`,
        isDirectory: item.attrs.isDirectory(),
        size: item.attrs.size,
        mtime: item.attrs.mtime
      }))
  }

  async deleteRemote(sessionId: string, remotePath: string): Promise<ApiResult> {
    const session = this.sessions.get(sessionId)
    if (session?.profile.protocol !== 'ssh') return { ok: false, error: 'Только для SSH' }
    if (!session || session.closed || session.status !== 'connected') return { ok: false, error: 'Нет соединения' }
    try {
      const sftp = await this.getSftp(sessionId)
      await new Promise<void>((res, rej) => { sftp.unlink(remotePath, (err) => err ? rej(err) : res()) })
      return { ok: true }
    } catch (e) { return { ok: false, error: describeError(e) } }
  }

  async mkdirRemote(sessionId: string, remotePath: string): Promise<ApiResult> {
    const session = this.sessions.get(sessionId)
    if (session?.profile.protocol !== 'ssh') return { ok: false, error: 'Только для SSH' }
    if (!session || session.closed || session.status !== 'connected') return { ok: false, error: 'Нет соединения' }
    try {
      const sftp = await this.getSftp(sessionId)
      await new Promise<void>((res, rej) => { sftp.mkdir(remotePath, (err) => err ? rej(err) : res()) })
      return { ok: true }
    } catch (e) { return { ok: false, error: describeError(e) } }
  }

  async renameRemote(sessionId: string, oldPath: string, newPath: string): Promise<ApiResult> {
    const session = this.sessions.get(sessionId)
    if (session?.profile.protocol !== 'ssh') return { ok: false, error: 'Только для SSH' }
    if (!session || session.closed || session.status !== 'connected') return { ok: false, error: 'Нет соединения' }
    try {
      const sftp = await this.getSftp(sessionId)
      await new Promise<void>((res, rej) => { sftp.rename(oldPath, newPath, (err) => err ? rej(err) : res()) })
      return { ok: true }
    } catch (e) { return { ok: false, error: describeError(e) } }
  }

  async cancelTransfer(transferId: string): Promise<void> {
    this.cancelledTransfers.add(transferId)
  }

  async providePassword(sessionId: string, password: string) {
    const session = this.sessions.get(sessionId)
    if (session && session.passwordResolver) {
      const resolver = session.passwordResolver
      session.passwordResolver = undefined
      resolver(password)
    }
  }

  async provideHostKey(sessionId: string, accept: boolean) {
    const session = this.sessions.get(sessionId)
    if (session && session.hostKeyResolver) {
      const resolver = session.hostKeyResolver
      session.hostKeyResolver = undefined
      resolver(accept)
    }
  }

  private enqueueTransfer(task: () => Promise<void>): void {
    this.transferQueue.push(task)
    this.processQueue()
  }

  private processQueue(): void {
    if (this.activeTransfersCount >= this.MAX_CONCURRENT_FILES) return
    const task = this.transferQueue.shift()
    if (!task) return
    this.activeTransfersCount++
    task().finally(() => { this.activeTransfersCount--; this.processQueue() })
  }

  private async getSftp(sessionId: string): Promise<SFTPWrapper> {
    if (this.sftpCache.has(sessionId)) return this.sftpCache.get(sessionId)!
    const session = this.sessions.get(sessionId)
    if (!session || !session.client) throw new Error('Нет активного SSH-соединения')
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      session.client!.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)))
    })
    this.sftpCache.set(sessionId, sftp)
    return sftp
  }

  private async uploadDirRecursive(sftp: SFTPWrapper, localDir: string, remoteDir: string, emit: any, transferId: string) {
    if (this.cancelledTransfers.has(transferId)) throw new Error('Отменено')
    await new Promise<void>((res) => sftp.mkdir(remoteDir, () => res()))
    const entries = await fs.readdir(localDir, { withFileTypes: true })
    for (const entry of entries) {
      const localPath = join(localDir, entry.name)
      const remotePath = `${remoteDir}/${entry.name}`.replace(/\/+/g, '/').replace(/\\/g, '/')
      if (entry.isDirectory()) {
        await this.uploadDirRecursive(sftp, localPath, remotePath, emit, transferId)
      } else if (entry.isFile()) {
        const stat = await fs.stat(localPath)
        await this.uploadFileInternal(sftp, localPath, remotePath, stat.size, emit, transferId)
      }
    }
  }

  private async uploadFileInternal(sftp: SFTPWrapper, localPath: string, remotePath: string, size: number, emit: any, transferId: string) {
    if (this.cancelledTransfers.has(transferId)) throw new Error('Отменено')
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, {
        concurrency: 16, chunkSize: 32768,
        step: (transferred) => {
          if (this.cancelledTransfers.has(transferId)) return
          emit(transferred, size, false)
        }
      }, (err) => err ? reject(err) : resolve())
    })
  }

  private async downloadDirRecursive(sftp: SFTPWrapper, remoteDir: string, localDir: string, emit: any, transferId: string) {
    if (this.cancelledTransfers.has(transferId)) throw new Error('Отменено')
    await fs.mkdir(localDir, { recursive: true })
    const list = await new Promise<FileEntry[]>((res, rej) =>
      sftp.readdir(remoteDir, (err, list) => err ? rej(err) : res(list))
    )
    for (const item of list) {
      if (item.filename === '.' || item.filename === '..') continue
      const rPath = `${remoteDir}/${item.filename}`.replace(/\/+/g, '/')
      const lPath = join(localDir, item.filename)
      if (item.attrs.isDirectory()) {
        await this.downloadDirRecursive(sftp, rPath, lPath, emit, transferId)
      } else if (item.attrs.isFile()) {
        await this.downloadFileInternal(sftp, rPath, localDir, item.attrs.size, emit, transferId)
      }
    }
  }

  private async downloadFileInternal(sftp: SFTPWrapper, remotePath: string, localDir: string, size: number, emit: any, transferId: string) {
    if (this.cancelledTransfers.has(transferId)) throw new Error('Отменено')
    const fileName = basename(remotePath)
    const localPath = join(localDir, fileName)
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, {
        concurrency: 16, chunkSize: 32768,
        step: (transferred) => {
          if (this.cancelledTransfers.has(transferId)) return
          emit(transferred, size, false)
        }
      }, (err) => err ? reject(err) : resolve())
    })
  }

  private endSession(session: ManagedSession, status: Extract<SessionStatus, 'disconnected' | 'error'>, message?: string) {
    if (session.closed) return
    session.closed = true
    this.sftpCache.delete(session.id)
    try { session.stream?.end() } catch {}
    try { session.telnetConnection?.destroy() } catch {}
    for (const c of session.clients) { try { c.end(); c.destroy() } catch {} }
    this.sessions.delete(session.id)
    this.sendStatus({ sessionId: session.id, status, message })
  }

  private sendStatus(event: SessionStatusEvent) {
    this.send(IPC.eventStatus, event)
  }

  // ==========================================
  // ПОЛНЫЙ КОД ТУННЕЛЕЙ (без заглушек)
  // ==========================================
  private emitTunnels(session: ManagedSession): void {
    if (session.closed) return
    const tunnels: TunnelRuntime[] = Array.from(session.tunnels.values()).map((tunnel) => ({
      ...tunnel.config,
      status: tunnel.status,
      boundHost: tunnel.boundHost,
      boundPort: tunnel.boundPort,
      message: tunnel.message
    }))
    const payload: TunnelsUpdatedEvent = { sessionId: session.id, tunnels }
    this.send(IPC.eventTunnels, payload)
  }

  private async startAutoTunnels(session: ManagedSession): Promise<void> {
    for (const tunnel of session.tunnels.values()) {
      if (session.closed || session.status !== 'connected') return
      if (!tunnel.config.autoStart) continue
      try { await this.startTunnelInternal(session, tunnel) } catch { undefined }
    }
  }

  private async startTunnelInternal(session: ManagedSession, tunnel: TunnelState): Promise<void> {
    if (session.closed || session.status !== 'connected') throw new Error('Сначала подключитесь к серверу')
    if (tunnel.status === 'running' || tunnel.status === 'starting') return
    const generation = ++tunnel.generation
    tunnel.status = 'starting'
    tunnel.message = undefined
    this.emitTunnels(session)
    try {
      if (tunnel.config.type === 'local') {
        await this.startLocalTunnel(session, tunnel, generation)
      } else if (tunnel.config.type === 'remote') {
        await this.startRemoteTunnel(session, tunnel, generation)
      } else {
        await this.startDynamicTunnel(session, tunnel, generation)
      }
      if (generation !== tunnel.generation || session.closed) {
        await this.releaseTunnel(session, tunnel)
        return
      }
      tunnel.status = 'running'
      this.emitTunnels(session)
    } catch (error) {
      if (generation === tunnel.generation) {
        await this.releaseTunnel(session, tunnel)
        tunnel.status = 'error'
        tunnel.message = describeError(error)
        this.emitTunnels(session)
      }
      throw error
    }
  }

  private async startLocalTunnel(session: ManagedSession, tunnel: TunnelState, generation: number): Promise<void> {
    const client = session.client
    if (!client) throw new Error('SSH-соединение не установлено')
    const config = tunnel.config
    const server = createServer((socket) => {
      this.trackSocket(tunnel, socket)
      if (session.closed || generation !== tunnel.generation) { socket.destroy(); return }
      socket.pause()
      this.forwardOut(client, config.destHost as string, config.destPort as number)
        .then((channel) => {
          if (session.closed || generation !== tunnel.generation || socket.destroyed) {
            channel.destroy(); socket.destroy(); return
          }
          socket.pipe(channel).pipe(socket)
          socket.resume()
          socket.on('error', () => channel.destroy())
          channel.on('error', () => socket.destroy())
          socket.on('close', () => channel.destroy())
          channel.on('close', () => socket.destroy())
        })
        .catch(() => socket.destroy())
    })
    await this.listenServer(server, config.bindHost, config.bindPort)
    tunnel.server = server
    tunnel.boundHost = config.bindHost
    tunnel.boundPort = serverPort(server, config.bindPort)
    server.on('error', (error) => {
      if (session.closed) return
      tunnel.status = 'error'
      tunnel.message = describeError(error)
      this.emitTunnels(session)
    })
    if (generation !== tunnel.generation || session.closed) {
      await closeServer(server)
      tunnel.server = undefined
    }
  }

  private async startRemoteTunnel(session: ManagedSession, tunnel: TunnelState, generation: number): Promise<void> {
    const client = session.client
    if (!client) throw new Error('SSH-соединение не установлено')
    const config = tunnel.config
    this.ensureRemoteDispatcher(session)
    const port = await new Promise<number>((resolve, reject) => {
      client.forwardIn(config.bindHost, config.bindPort, (error, boundPort) => {
        if (error) reject(error)
        else resolve(boundPort || config.bindPort)
      })
    })
    tunnel.boundHost = config.bindHost
    tunnel.boundPort = port
  }

  private async startDynamicTunnel(session: ManagedSession, tunnel: TunnelState, generation: number): Promise<void> {
    if (!session.client) throw new Error('SSH-соединение не установлено')
    const config = tunnel.config
    const server = createServer((socket) => {
      this.trackSocket(tunnel, socket)
      if (session.closed || generation !== tunnel.generation) { socket.destroy(); return }
      this.handleSocks(session, tunnel, socket, generation)
    })
    await this.listenServer(server, config.bindHost, config.bindPort)
    tunnel.server = server
    tunnel.boundHost = config.bindHost
    tunnel.boundPort = serverPort(server, config.bindPort)
    server.on('error', (error) => {
      if (session.closed) return
      tunnel.status = 'error'
      tunnel.message = describeError(error)
      this.emitTunnels(session)
    })
    if (generation !== tunnel.generation || session.closed) {
      await closeServer(server)
      tunnel.server = undefined
    }
  }

  private handleSocks(session: ManagedSession, tunnel: TunnelState, socket: Socket, generation: number): void {
    let buffer = Buffer.alloc(0)
    let greeted = false
    let parsingDone = false
    let responded = false
    socket.setTimeout(15000)
    socket.on('timeout', () => socket.destroy())
    socket.on('error', () => socket.destroy())

    const fail = (code: number): void => {
      if (responded) return
      responded = true
      parsingDone = true
      socket.removeListener('data', onData)
      if (!socket.destroyed) socket.end(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]))
    }

    const succeed = (destinationHost: string, destinationPort: number, client: Client): void => {
      this.forwardOut(client, destinationHost, destinationPort)
        .then((channel) => {
          if (responded || socket.destroyed || session.closed || generation !== tunnel.generation) {
            channel.destroy(); socket.destroy(); return
          }
          responded = true
          socket.setTimeout(0)
          socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          socket.pipe(channel).pipe(socket)
          socket.resume()
          socket.on('error', () => channel.destroy())
          channel.on('error', () => socket.destroy())
          socket.on('close', () => channel.destroy())
          channel.on('close', () => socket.destroy())
        })
        .catch(() => fail(5))
    }

    const readRequest = (): void => {
      if (buffer.length < 4) return
      if (buffer[0] !== 5) { fail(1); return }
      const command = buffer[1]
      if (command !== 1) { fail(7); return }
      const addressType = buffer[3]
      let offset = 4
      let host = ''
      if (addressType === 1) {
        if (buffer.length < offset + 4 + 2) return
        host = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`
        offset += 4
      } else if (addressType === 3) {
        if (buffer.length < offset + 1) return
        const length = buffer[offset]
        offset += 1
        if (buffer.length < offset + length + 2) return
        host = buffer.subarray(offset, offset + length).toString('utf8')
        offset += length
      } else if (addressType === 4) {
        if (buffer.length < offset + 16 + 2) return
        const groups: string[] = []
        for (let index = 0; index < 8; index += 1) groups.push(buffer.readUInt16BE(offset + index * 2).toString(16))
        host = groups.join(':')
        offset += 16
      } else { fail(8); return }
      if (!host) { fail(8); return }
      const port = buffer.readUInt16BE(offset)
      offset += 2
      if (port < 1) { fail(1); return }
      buffer = buffer.subarray(offset)
      parsingDone = true
      socket.removeListener('data', onData)
      socket.pause()
      if (buffer.length > 0) socket.unshift(buffer)
      const client = session.client
      if (!client) { fail(1); return }
      succeed(host, port, client)
    }

    const processBuffer = (): void => {
      while (!parsingDone) {
        if (!greeted) {
          if (buffer.length < 2) return
          if (buffer[0] !== 5) { fail(1); return }
          const methodsLength = buffer[1]
          if (buffer.length < 2 + methodsLength) return
          const methods = buffer.subarray(2, 2 + methodsLength)
          buffer = buffer.subarray(2 + methodsLength)
          if (!methods.includes(0)) { responded = true; parsingDone = true; socket.removeListener('data', onData); socket.end(Buffer.from([5, 255])); return }
          greeted = true
          socket.write(Buffer.from([5, 0]))
          continue
        }
        if (buffer.length < 4) return
        const needed = requiredSocksLength(buffer)
        if (needed === -1) { fail(8); return }
        if (buffer.length < needed) return
        readRequest()
        return
      }
    }

    const onData = (chunk: Buffer): void => {
      if (parsingDone) return
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 8192) { fail(1); return }
      processBuffer()
    }

    socket.on('data', onData)
  }

  private ensureRemoteDispatcher(session: ManagedSession): void {
    if (session.remoteHandler || !session.client) return
    const client = session.client
    session.remoteHandler = (details, accept, reject) => {
      if (session.closed) { reject(); return }
      for (const tunnel of session.tunnels.values()) {
        if (tunnel.config.type !== 'remote' || tunnel.status !== 'running') continue
        if (tunnel.boundPort !== details.destPort) continue
        const config = tunnel.config
        if (!config.destHost || !config.destPort) { reject(); return }
        let channel: ClientChannel
        try { channel = accept() } catch { reject(); return }
        const local = createSocket({ host: config.destHost, port: config.destPort, allowHalfOpen: true })
        this.trackSocket(tunnel, local)
        local.on('connect', () => { channel.pipe(local).pipe(channel) })
        local.on('error', () => channel.destroy())
        channel.on('error', () => local.destroy())
        local.on('close', () => channel.destroy())
        channel.on('close', () => local.destroy())
        return
      }
      reject()
    }
    client.on('tcp connection', session.remoteHandler)
  }

  private async stopTunnelInternal(session: ManagedSession, tunnel: TunnelState, notify: boolean): Promise<void> {
    tunnel.generation += 1
    await this.releaseTunnel(session, tunnel)
    tunnel.status = 'stopped'
    tunnel.message = undefined
    tunnel.boundHost = undefined
    tunnel.boundPort = undefined
    if (notify) this.emitTunnels(session)
  }

  private async releaseTunnel(session: ManagedSession, tunnel: TunnelState): Promise<void> {
    const server = tunnel.server
    tunnel.server = undefined
    for (const socket of tunnel.sockets) socket.destroy()
    tunnel.sockets.clear()
    if (tunnel.config.type === 'remote' && session.client && tunnel.boundPort) {
      try { session.client.unforwardIn(tunnel.config.bindHost, tunnel.boundPort, () => undefined) } catch { undefined }
    }
    if (server) await closeServer(server)
  }

  private trackSocket(tunnel: TunnelState, socket: Socket): void {
    tunnel.sockets.add(socket)
    socket.on('close', () => tunnel.sockets.delete(socket))
  }

  private listenServer(server: Server, host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => { server.removeListener('listening', onListening); reject(error) }
      const onListening = (): void => { server.removeListener('error', onError); resolve() }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen({ host, port })
    })
  }

  private forwardOut(client: Client, host: string, port: number): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
        if (error) reject(error)
        else resolve(channel)
      })
    })
  }
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================
function normalizeDimension(value: number, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function serverPort(server: Server, fallback: number): number {
  const address = server.address()
  return typeof address === 'object' && address ? address.port : fallback
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    try { server.close(() => resolve()) } catch { resolve() }
  })
}

function requiredSocksLength(buffer: Buffer): number {
  if (buffer.length < 4) return -1
  const addressType = buffer[3]
  if (addressType === 1) return 4 + 4 + 2
  if (addressType === 4) return 4 + 16 + 2
  if (addressType === 3) {
    if (buffer.length < 5) return -1
    return 4 + 1 + buffer[4] + 2
  }
  return -1
}