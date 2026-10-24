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
  hostKey?: string
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
const PROTOCOLS: Protocol[] = ['ssh', 'telnet']

export class ProfileStore {
  private data: StoreFile = { version: 1, profiles: [] }
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  static defaultPath(): string {
    return join(app.getPath('userData'), 'profiles.json')
  }

  async init(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
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
    
    if (draft.authMethod === 'password' && !password && !draft.askPassword) {
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
      hostKey: draft.hostKey,
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
    
    if (draft.authMethod === 'password' && !password && !draft.askPassword) {
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
      hostKey: draft.hostKey,
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
    try {
      const parsed = JSON.parse(json)
      if (!parsed || !Array.isArray(parsed.profiles)) throw new Error('Неверный формат')
      const newProfiles = parsed.profiles.map((p: any) => ({
        ...p,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsedAt: undefined
      }))
      this.data.profiles.push(...newProfiles)
      await this.persist()
    } catch (e) {
      throw new Error('Не удалось импортировать профили')
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
      hostKey: p.hostKey,
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

    return {
      name,
      group: String(input.group ?? '').trim(),
      protocol,
      host,
      port,
      username,
      authMethod,
      privateKeyPath: input.privateKeyPath?.trim() || undefined,
      jumpProfileId,
      tunnels,
      askPassword: Boolean(input.askPassword),
      keepaliveInterval: Number(input.keepaliveInterval) || 15000,
      proxyType,
      proxyHost: input.proxyHost?.trim() || undefined,
      proxyPort: input.proxyPort ? Number(input.proxyPort) : undefined,
      proxyUsername: input.proxyUsername?.trim() || undefined,
      proxyPassword: input.proxyPassword || undefined,
      hostKey: input.hostKey,
      password: input.password || undefined,
      passphrase: input.passphrase || undefined,
      clearPassword: Boolean(input.clearPassword),
      clearPassphrase: Boolean(input.clearPassphrase)
    }
  }

  private normalizeTunnel(tunnel: TunnelConfig): TunnelConfig {
    if (!tunnel || !TUNNEL_TYPES.includes(tunnel.type)) throw new Error('Неверный тип туннеля')
    return {
      id: typeof tunnel.id === 'string' && tunnel.id ? tunnel.id : randomUUID(),
      name: String(tunnel.name ?? '').trim() || 'Туннель',
      type: tunnel.type,
      bindHost: String(tunnel.bindHost || '127.0.0.1').trim(),
      bindPort: Number(tunnel.bindPort) || 0,
      destHost: tunnel.destHost?.trim(),
      destPort: tunnel.destPort ? Number(tunnel.destPort) : undefined,
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