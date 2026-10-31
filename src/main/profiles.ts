import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AuthMethod,
  ConnectionProfile,
  ProfileDraft,
  TunnelConfig,
  TunnelType,
  ProxyType,
  Protocol
} from '../shared/types'

interface StoredSecret { scheme: 'safe' | 'plain'; data: string }

interface StoredProfile {
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
  proxyPassword?: StoredSecret
  bindAddress?: string
  hostKey?: string
  moshClientPath?: string
  password?: StoredSecret
  passphrase?: StoredSecret
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

interface StoreFile { version: 1; profiles: StoredProfile[] }

export interface ResolvedProfile extends ConnectionProfile {
  password?: string
  passphrase?: string
  proxyPassword?: string
}

const TUNNEL_TYPES: TunnelType[] = ['local', 'remote', 'dynamic']
const AUTH_METHODS: AuthMethod[] = ['password', 'key', 'agent']
const PROXY_TYPES: ProxyType[] = ['none', 'socks5', 'http']
const PROTOCOLS: Protocol[] = ['ssh', 'mosh', 'telnet']

export class ProfileStore {
  private data: StoreFile = { version: 1, profiles: [] }
  private loaded = false
  private initPromise: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private warnedPlaintext = false

  constructor(private readonly filePath: string) {}

  static defaultPath(): string {
    return join(app.getPath('userData'), 'profiles.json')
  }

  async init(): Promise<void> {
    if (this.loaded) return
    if (!this.initPromise) this.initPromise = this.load()
    await this.initPromise
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoreFile>
      if (!parsed || !Array.isArray(parsed.profiles)) throw new Error('Invalid storage format')
      this.data = {
        version: 1,
        profiles: parsed.profiles.filter(
          (p): p is StoredProfile => Boolean(p) && typeof p.id === 'string'
        )
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.error('Failed to read profiles:', error)
      this.data = { version: 1, profiles: [] }
    } finally {
      this.loaded = true
    }
  }

  async list(): Promise<ConnectionProfile[]> {
    await this.init()
    return this.data.profiles.map((p) => this.toPublic(p))
  }

  async getResolved(id: string): Promise<ResolvedProfile | null> {
    await this.init()
    const p = this.find(id)
    if (!p) return null
    return {
      ...this.toPublic(p),
      password: this.decrypt(p.password),
      passphrase: this.decrypt(p.passphrase),
      proxyPassword: this.decrypt(p.proxyPassword)
    }
  }

  async resolveChain(id: string): Promise<ResolvedProfile[]> {
    await this.init()
    const chain: ResolvedProfile[] = []
    const seen = new Set<string>()
    let current = this.find(id)
    if (!current) throw new Error('Подключение не найдено')
    while (current) {
      if (seen.has(current.id)) throw new Error('Циклическая цепочка jump-хостов')
      seen.add(current.id)
      chain.unshift({
        ...this.toPublic(current),
        password: this.decrypt(current.password),
        passphrase: this.decrypt(current.passphrase),
        proxyPassword: this.decrypt(current.proxyPassword)
      })
      if (!current.jumpProfileId) break
      const parent = this.find(current.jumpProfileId)
      if (!parent) throw new Error(`Jump-хост «${current.jumpProfileId}» не найден`)
      current = parent
    }
    return chain
  }

  async create(input: ProfileDraft): Promise<ConnectionProfile> {
    await this.init()
    const id = randomUUID()
    const now = new Date().toISOString()
    const draft = this.normalizeDraft(input, id)
    this.assertJumpChain(id, draft.jumpProfileId)
    
    const password = draft.password ? this.encrypt(draft.password) : undefined
    const proxyPassword = draft.proxyPassword ? this.encrypt(draft.proxyPassword) : undefined
    
    if (draft.protocol !== 'telnet' && draft.authMethod === 'password' && !password && !draft.askPassword) {
      throw new Error('Укажите пароль или включите запрос при подключении')
    }
    
    const profile: StoredProfile = {
      id,
      name: draft.name,
      group: draft.group,
      protocol: draft.protocol,
      host: draft.host,
      port: draft.port,
      username: draft.username,
      authMethod: draft.authMethod,
      privateKeyPath: draft.privateKeyPath,
      jumpProfileId: draft.jumpProfileId,
      tunnels: draft.tunnels,
      askPassword: draft.askPassword,
      keepaliveInterval: draft.keepaliveInterval,
      proxyType: draft.proxyType,
      proxyHost: draft.proxyHost,
      proxyPort: draft.proxyPort,
      proxyUsername: draft.proxyUsername,
      proxyPassword,
      bindAddress: draft.bindAddress,
      hostKey: draft.hostKey,
      moshClientPath: draft.moshClientPath,
      password,
      passphrase: draft.passphrase ? this.encrypt(draft.passphrase) : undefined,
      createdAt: now,
      updatedAt: now
    }
    this.data.profiles.push(profile)
    await this.persist()
    return this.toPublic(profile)
  }

  async update(id: string, input: ProfileDraft): Promise<ConnectionProfile> {
    await this.init()
    const index = this.data.profiles.findIndex((p) => p.id === id)
    if (index === -1) throw new Error('Подключение не найдено')
    const existing = this.data.profiles[index]
    const draft = this.normalizeDraft(input, id)
    this.assertJumpChain(id, draft.jumpProfileId)
    
    const password = draft.clearPassword ? undefined : draft.password ? this.encrypt(draft.password) : existing.password
    const proxyPassword = draft.proxyPassword ? this.encrypt(draft.proxyPassword) : existing.proxyPassword
    
    if (draft.protocol !== 'telnet' && draft.authMethod === 'password' && !password && !draft.askPassword) {
      throw new Error('Введите новый пароль или включите запрос при подключении')
    }

    const updated: StoredProfile = {
      id,
      name: draft.name,
      group: draft.group,
      protocol: draft.protocol,
      host: draft.host,
      port: draft.port,
      username: draft.username,
      authMethod: draft.authMethod,
      privateKeyPath: draft.privateKeyPath,
      jumpProfileId: draft.jumpProfileId,
      tunnels: draft.tunnels,
      askPassword: draft.askPassword,
      keepaliveInterval: draft.keepaliveInterval,
      proxyType: draft.proxyType,
      proxyHost: draft.proxyHost,
      proxyPort: draft.proxyPort,
      proxyUsername: draft.proxyUsername,
      proxyPassword,
      bindAddress: draft.bindAddress,
      hostKey: draft.hostKey ?? existing.hostKey,
      moshClientPath: draft.moshClientPath,
      password,
      passphrase: draft.clearPassphrase ? undefined : draft.passphrase ? this.encrypt(draft.passphrase) : existing.passphrase,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      lastUsedAt: existing.lastUsedAt
    }
    this.data.profiles[index] = updated
    await this.persist()
    return this.toPublic(updated)
  }

  async remove(id: string): Promise<void> {
    await this.init()
    const before = this.data.profiles.length
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id)
    if (this.data.profiles.length === before) throw new Error('Не найдено')
    for (const p of this.data.profiles) {
      if (p.jumpProfileId === id) p.jumpProfileId = undefined
    }
    await this.persist()
  }

  async duplicate(id: string): Promise<ConnectionProfile> {
    await this.init()
    const source = this.find(id)
    if (!source) throw new Error('Не найдено')
    const now = new Date().toISOString()
    const copy: StoredProfile = {
      ...structuredClone(source),
      id: randomUUID(),
      name: `${source.name} (копия)`,
      tunnels: source.tunnels.map((t) => ({ ...t, id: randomUUID() })),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: undefined
    }
    this.data.profiles.push(copy)
    await this.persist()
    return this.toPublic(copy)
  }

  async exportProfiles(): Promise<string> {
    await this.init()
    const safeProfiles = this.data.profiles.map((p) => {
      const { password, passphrase, proxyPassword, ...rest } = p
      return rest
    })
    return JSON.stringify({ version: 1, profiles: safeProfiles }, null, 2)
  }

  async importProfiles(json: string): Promise<void> {
    await this.init()
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      throw new Error('Неверный формат файла профилей')
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { profiles?: unknown }).profiles)) {
      throw new Error('Неверный формат файла профилей')
    }
    const rawProfiles = (parsed as { profiles: unknown[] }).profiles
    const idMap = new Map<string, string>()
    for (const raw of rawProfiles) {
      if (!raw || typeof raw !== 'object') throw new Error('Неверный формат профиля')
      const oldId = (raw as { id?: unknown }).id
      if (typeof oldId === 'string' && oldId && !idMap.has(oldId)) idMap.set(oldId, randomUUID())
    }

    const now = new Date().toISOString()
    const usedIds = new Set<string>()
    const imported: StoredProfile[] = rawProfiles.map((raw) => {
      const data = raw as Record<string, unknown>
      const oldId = typeof data.id === 'string' ? data.id : ''
      let id = idMap.get(oldId) ?? randomUUID()
      if (usedIds.has(id)) id = randomUUID()
      usedIds.add(id)

      const draft = this.normalizeDraft({
        name: data.name,
        group: data.group,
        protocol: data.protocol,
        host: data.host,
        port: data.port,
        username: data.username,
        authMethod: data.authMethod,
        privateKeyPath: data.privateKeyPath,
        jumpProfileId: undefined,
        tunnels: data.tunnels,
        askPassword: data.askPassword,
        keepaliveInterval: data.keepaliveInterval,
        proxyType: data.proxyType,
        proxyHost: data.proxyHost,
        proxyPort: data.proxyPort,
        proxyUsername: data.proxyUsername,
        bindAddress: data.bindAddress,
        hostKey: data.hostKey,
        moshClientPath: data.moshClientPath
      } as unknown as ProfileDraft, id)

      let jumpProfileId: string | undefined
      const oldJumpId = typeof data.jumpProfileId === 'string' ? data.jumpProfileId : ''
      if (oldJumpId) {
        jumpProfileId = idMap.get(oldJumpId) ?? (this.find(oldJumpId) ? oldJumpId : undefined)
        if (!jumpProfileId) throw new Error(`Jump-хост «${oldJumpId}» не найден`)
      }

      return {
        id,
        name: draft.name,
        group: draft.group,
        protocol: draft.protocol,
        host: draft.host,
        port: draft.port,
        username: draft.username,
        authMethod: draft.authMethod,
        privateKeyPath: draft.privateKeyPath,
        jumpProfileId,
        tunnels: draft.tunnels,
        askPassword: draft.askPassword,
        keepaliveInterval: draft.keepaliveInterval,
        proxyType: draft.proxyType,
        proxyHost: draft.proxyHost,
        proxyPort: draft.proxyPort,
        proxyUsername: draft.proxyUsername,
        bindAddress: draft.bindAddress,
        hostKey: draft.hostKey,
        moshClientPath: draft.moshClientPath,
        createdAt: now,
        updatedAt: now
      }
    })

    const previous = this.data.profiles
    this.data.profiles = [...previous, ...imported]
    try {
      for (const profile of imported) this.assertJumpChain(profile.id, profile.jumpProfileId)
      await this.persist()
    } catch (error) {
      this.data.profiles = previous
      throw error
    }
  }

  async touch(id: string): Promise<void> {
    await this.init()
    const p = this.find(id)
    if (!p) return
    p.lastUsedAt = new Date().toISOString()
    await this.persist()
  }

  private toPublic(p: StoredProfile): ConnectionProfile {
    return {
      id: p.id,
      name: p.name,
      group: p.group || '',
      protocol: p.protocol || 'ssh',
      host: p.host,
      port: p.port,
      username: p.username,
      authMethod: p.authMethod,
      privateKeyPath: p.privateKeyPath,
      jumpProfileId: p.jumpProfileId,
      tunnels: Array.isArray(p.tunnels) ? p.tunnels : [],
      askPassword: Boolean(p.askPassword),
      keepaliveInterval: p.keepaliveInterval ?? 15000,
      proxyType: p.proxyType ?? 'none',
      proxyHost: p.proxyHost,
      proxyPort: p.proxyPort,
      proxyUsername: p.proxyUsername,
      bindAddress: p.bindAddress,
      hostKey: p.hostKey,
      moshClientPath: p.moshClientPath,
      hasPassword: Boolean(p.password),
      hasPassphrase: Boolean(p.passphrase),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      lastUsedAt: p.lastUsedAt
    }
  }

  private normalizeDraft(input: ProfileDraft, id: string): ProfileDraft {
    if (!input || typeof input !== 'object') throw new Error('Некорректные данные')
    const name = String(input.name ?? '').trim()
    const host = String(input.host ?? '').trim()
    const username = String(input.username ?? '').trim()
    if (!name) throw new Error('Укажите название')
    if (!host) throw new Error('Укажите адрес сервера')
    if (!username) throw new Error('Укажите имя пользователя')
    
    const protocol = PROTOCOLS.includes(input.protocol) ? input.protocol : 'ssh'
    const port = Number(input.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Неверный порт')

    const authMethod = AUTH_METHODS.includes(input.authMethod) ? input.authMethod : 'password'
    const privateKeyPath = input.privateKeyPath?.trim() || undefined
    if (protocol !== 'telnet' && authMethod === 'key' && !privateKeyPath) {
      throw new Error('Укажите путь к приватному ключу')
    }
    let jumpProfileId = input.jumpProfileId?.trim() || undefined
    if (jumpProfileId === id) jumpProfileId = undefined
    if (jumpProfileId && !this.find(jumpProfileId)) throw new Error('Jump-хост не найден')

    const tunnelIds = new Set<string>()
    const tunnels = Array.isArray(input.tunnels)
      ? input.tunnels.map((t) => {
          const norm = this.normalizeTunnel(t)
          if (tunnelIds.has(norm.id)) norm.id = randomUUID()
          tunnelIds.add(norm.id)
          return norm
        })
      : []

    const proxyType = PROXY_TYPES.includes(input.proxyType) ? input.proxyType : 'none'
    const proxyHost = input.proxyHost?.trim() || undefined
    let proxyPort: number | undefined
    if (proxyType !== 'none') {
      if (!proxyHost) throw new Error('Укажите хост прокси')
      proxyPort = Number(input.proxyPort)
      if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
        throw new Error('Неверный порт прокси')
      }
    }

    return {
      name,
      group: String(input.group ?? '').trim(),
      protocol,
      host,
      port,
      username,
      authMethod,
      privateKeyPath,
      jumpProfileId,
      tunnels,
      askPassword: Boolean(input.askPassword),
      keepaliveInterval: Number(input.keepaliveInterval) || 15000,
      proxyType,
      proxyHost,
      proxyPort,
      proxyUsername: input.proxyUsername?.trim() || undefined,
      proxyPassword: input.proxyPassword || undefined,
      bindAddress: input.bindAddress?.trim() || undefined,
      hostKey: typeof input.hostKey === 'string' ? input.hostKey : undefined,
      moshClientPath: input.moshClientPath?.trim() || undefined,
      password: input.password || undefined,
      passphrase: input.passphrase || undefined,
      clearPassword: Boolean(input.clearPassword),
      clearPassphrase: Boolean(input.clearPassphrase)
    }
  }

  private normalizeTunnel(tunnel: TunnelConfig): TunnelConfig {
    if (!tunnel || !TUNNEL_TYPES.includes(tunnel.type)) throw new Error('Неверный тип туннеля')
    const bindPort = Number(tunnel.bindPort)
    if (!Number.isInteger(bindPort) || bindPort < 0 || bindPort > 65535) {
      throw new Error('Неверный порт туннеля')
    }
    const destHost = tunnel.destHost?.trim()
    let destPort: number | undefined
    if (tunnel.type !== 'dynamic') {
      if (!destHost) throw new Error('Укажите хост назначения туннеля')
      destPort = Number(tunnel.destPort)
      if (!Number.isInteger(destPort) || destPort < 1 || destPort > 65535) {
        throw new Error('Неверный порт назначения туннеля')
      }
    }
    return {
      id: typeof tunnel.id === 'string' && tunnel.id ? tunnel.id : randomUUID(),
      name: String(tunnel.name ?? '').trim() || 'Туннель',
      type: tunnel.type,
      bindHost: String(tunnel.bindHost || '127.0.0.1').trim(),
      bindPort,
      destHost,
      destPort,
      autoStart: Boolean(tunnel.autoStart)
    }
  }

  private assertJumpChain(id: string, jumpProfileId?: string): void {
    const seen = new Set<string>([id])
    let current = jumpProfileId
    while (current) {
      if (seen.has(current)) throw new Error('Цепочка jump-хостов зациклена')
      seen.add(current)
      const p = this.find(current)
      if (!p) throw new Error('Jump-хост не найден')
      current = p.jumpProfileId
    }
  }

  private find(id: string): StoredProfile | undefined {
    return this.data.profiles.find((p) => p.id === id)
  }

  private encrypt(value: string): StoredSecret {
    if (safeStorage.isEncryptionAvailable()) {
      return { scheme: 'safe', data: safeStorage.encryptString(value).toString('base64') }
    }
    if (!this.warnedPlaintext) {
      this.warnedPlaintext = true
      console.warn('Safe storage is unavailable; saved passwords will not be encrypted by the OS.')
    }
    return { scheme: 'plain', data: Buffer.from(value, 'utf8').toString('base64') }
  }

  private decrypt(secret?: StoredSecret): string | undefined {
    if (!secret) return undefined
    try {
      const buf = Buffer.from(secret.data, 'base64')
      return secret.scheme === 'safe' ? safeStorage.decryptString(buf) : buf.toString('utf8')
    } catch {
      return undefined
    }
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2)
    const filePath = this.filePath
    const write = this.writeQueue.then(async () => {
      await fs.mkdir(dirname(filePath), { recursive: true })
      const tempPath = `${filePath}.tmp`
      await fs.writeFile(tempPath, snapshot, 'utf8')
      await fs.rename(tempPath, filePath)
    })
    this.writeQueue = write.catch(() => undefined)
    await write
  }
}