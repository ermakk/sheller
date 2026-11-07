import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProfileDraft, TunnelConfig } from '../shared/types'
import { ProfileStore } from './profiles'

const electronState = vi.hoisted(() => ({
  userData: '',
  encryptAvailable: true
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronState.userData)
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => electronState.encryptAvailable),
    encryptString: vi.fn((value: string) => Buffer.from(`safe:${value}`, 'utf8')),
    decryptString: vi.fn((buffer: Buffer) => {
      const value = buffer.toString('utf8')
      if (!value.startsWith('safe:')) throw new Error('bad ciphertext')
      return value.slice(5)
    })
  }
}))

function draft(overrides: Partial<ProfileDraft> = {}): ProfileDraft {
  return {
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
    password: 'secret',
    ...overrides
  }
}

function tunnel(overrides: Partial<TunnelConfig> = {}): TunnelConfig {
  return {
    id: 'tunnel-1',
    name: 'Web',
    type: 'local',
    bindHost: '127.0.0.1',
    bindPort: 8080,
    destHost: '127.0.0.1',
    destPort: 80,
    autoStart: false,
    ...overrides
  }
}

describe('ProfileStore', () => {
  let dir: string
  let filePath: string
  let store: ProfileStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sheller-profiles-'))
    filePath = join(dir, 'profiles.json')
    store = new ProfileStore(filePath)
    electronState.userData = dir
    electronState.encryptAvailable = true
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('возвращает путь по умолчанию в userData', () => {
    expect(ProfileStore.defaultPath()).toBe(join(dir, 'profiles.json'))
  })

  it('загружает пустое хранилище при отсутствии файла', async () => {
    await expect(store.list()).resolves.toEqual([])
  })

  it('игнорирует повреждённый файл и профили без id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await writeFile(filePath, JSON.stringify({ profiles: [{ id: 'valid', name: 'A' }, { name: 'no-id' }, null] }), 'utf8')
    await expect(store.list()).resolves.toMatchObject([{ id: 'valid' }])
    expect(error).not.toHaveBeenCalled()

    const broken = new ProfileStore(filePath)
    await writeFile(filePath, '{not-json', 'utf8')
    await expect(broken.list()).resolves.toEqual([])
    expect(error).toHaveBeenCalled()
  })

  it('повторно использует загруженные данные', async () => {
    await store.init()
    await store.init()
    await expect(store.list()).resolves.toEqual([])
  })

  it('создаёт профиль и шифрует секреты', async () => {
    const created = await store.create(draft({ passphrase: 'phrase' }))
    expect(created.id).toBeTruthy()
    expect(created.name).toBe('Server')
    expect(created.hasPassword).toBe(true)
    expect(created.hasPassphrase).toBe(true)
    expect('password' in created).toBe(false)
    expect('proxyPassword' in created).toBe(false)

    const stored = JSON.parse(await readFile(filePath, 'utf8')) as {
      profiles: Array<Record<string, unknown>>
    }
    expect(stored.profiles).toHaveLength(1)
    expect(stored.profiles[0].password).toEqual({ scheme: 'safe', data: Buffer.from('safe:secret').toString('base64') })
    expect(JSON.stringify(stored)).not.toContain('secret')

    const resolved = await store.getResolved(created.id)
    expect(resolved).toMatchObject({ password: 'secret', passphrase: 'phrase' })
  })

  it('требует пароль или запрос пароля для SSH', async () => {
    await expect(store.create(draft({ password: undefined }))).rejects.toThrow('Укажите пароль')
    await expect(store.create(draft({ password: undefined, askPassword: true }))).resolves.toMatchObject({ hasPassword: false })
    await expect(store.create(draft({ protocol: 'telnet', port: 23, password: undefined }))).resolves.toMatchObject({ protocol: 'telnet' })
  })

  it('валидирует обязательные поля и порт', async () => {
    await expect(store.create(draft({ name: ' ' }))).rejects.toThrow('Укажите название')
    await expect(store.create(draft({ host: ' ' }))).rejects.toThrow('Укажите адрес сервера')
    await expect(store.create(draft({ username: ' ' }))).rejects.toThrow('Укажите имя пользователя')
    await expect(store.create(draft({ port: 0 }))).rejects.toThrow('Неверный порт')
    await expect(store.create(draft({ port: 70000 }))).rejects.toThrow('Неверный порт')
    await expect(store.create(draft({ port: 22.5 }))).rejects.toThrow('Неверный порт')
    await expect(store.create(null as unknown as ProfileDraft)).rejects.toThrow('Некорректные данные')
  })

  it('валидирует ключ, прокси и туннели', async () => {
    await expect(store.create(draft({ authMethod: 'key' }))).rejects.toThrow('Укажите путь к приватному ключу')
    await expect(store.create(draft({ proxyType: 'socks5' }))).rejects.toThrow('Укажите хост прокси')
    await expect(store.create(draft({ proxyType: 'socks5', proxyHost: 'proxy' }))).rejects.toThrow('Неверный порт прокси')
    await expect(store.create(draft({ proxyType: 'socks5', proxyHost: 'proxy', proxyPort: 0 }))).rejects.toThrow('Неверный порт прокси')
    await expect(store.create(draft({ tunnels: [tunnel({ type: 'bad' as 'local' })] }))).rejects.toThrow('Неверный тип туннеля')
    await expect(store.create(draft({ tunnels: [tunnel({ bindPort: -1 })] }))).rejects.toThrow('Неверный порт туннеля')
    await expect(store.create(draft({ tunnels: [tunnel({ destHost: '' })] }))).rejects.toThrow('Укажите хост назначения')
    await expect(store.create(draft({ tunnels: [tunnel({ destPort: 0 })] }))).rejects.toThrow('Неверный порт назначения')
  })

  it('нормализует туннели и уникализирует их id', async () => {
    const created = await store.create(draft({
      tunnels: [
        tunnel({ id: 'same', name: '  ', bindPort: 0 }),
        tunnel({ id: 'same', type: 'dynamic', destHost: undefined, destPort: undefined })
      ]
    }))
    expect(created.tunnels).toHaveLength(2)
    expect(created.tunnels[0].name).toBe('Туннель')
    expect(created.tunnels[0].bindHost).toBe('127.0.0.1')
    expect(created.tunnels[0].id).not.toBe(created.tunnels[1].id)
    expect(created.tunnels[1].destHost).toBeUndefined()
  })

  it('не сохраняет plaintext-предупреждение повторно', async () => {
    electronState.encryptAvailable = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await store.create(draft())
    await store.create(draft({ name: 'Second' }))
    expect(warn).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(await readFile(filePath, 'utf8')) as { profiles: Array<{ password: { scheme: string } }> }
    expect(stored.profiles[0].password.scheme).toBe('plain')
  })

  it('возвращает undefined при ошибке расшифровки', async () => {
    await writeFile(filePath, JSON.stringify({
      version: 1,
      profiles: [{
        ...draft(),
        id: 'p1',
        password: { scheme: 'safe', data: Buffer.from('broken').toString('base64') },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      }]
    }), 'utf8')
    await expect(store.getResolved('p1')).resolves.toMatchObject({ password: undefined })
  })

  it('получает профиль и разрешает цепочку jump-хостов', async () => {
    const jump = await store.create(draft({ name: 'Jump' }))
    const middle = await store.create(draft({ name: 'Middle', jumpProfileId: jump.id }))
    const target = await store.create(draft({ name: 'Target', jumpProfileId: middle.id }))

    expect(await store.getResolved('missing')).toBeNull()
    const chain = await store.resolveChain(target.id)
    expect(chain.map((item) => item.name)).toEqual(['Jump', 'Middle', 'Target'])
    expect(chain[2]).toMatchObject({ password: 'secret' })
  })

  it('обнаруживает отсутствующий и циклический jump-хост', async () => {
    await expect(store.create(draft({ jumpProfileId: 'missing' }))).rejects.toThrow('Jump-хост не найден')
    const first = await store.create(draft({ name: 'First' }))
    const second = await store.create(draft({ name: 'Second', jumpProfileId: first.id }))
    await expect(store.update(first.id, draft({ name: 'First', jumpProfileId: second.id }))).rejects.toThrow('зациклена')

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { profiles: Array<{ id: string; jumpProfileId?: string }> }
    raw.profiles.find((p) => p.id === first.id)!.jumpProfileId = second.id
    await writeFile(filePath, JSON.stringify(raw), 'utf8')
    const broken = new ProfileStore(filePath)
    await expect(broken.resolveChain(first.id)).rejects.toThrow('Циклическая цепочка')
    raw.profiles[0].jumpProfileId = 'missing'
    await writeFile(filePath, JSON.stringify(raw), 'utf8')
    const missing = new ProfileStore(filePath)
    await expect(missing.resolveChain(first.id)).rejects.toThrow('не найден')
  })

  it('игнорирует jump на самого себя', async () => {
    const created = await store.create(draft())
    const updated = await store.update(created.id, draft({ name: 'Self', jumpProfileId: created.id }))
    expect(updated.jumpProfileId).toBeUndefined()
  })

  it('обновляет профиль, сохраняет и очищает секреты', async () => {
    const created = await store.create(draft({ passphrase: 'phrase' }))
    await expect(store.update('missing', draft())).rejects.toThrow('Подключение не найдено')

    const updated = await store.update(created.id, draft({ name: 'Updated', password: 'next', hostKey: 'SHA256:key' }))
    expect(updated.name).toBe('Updated')
    expect(updated.hostKey).toBe('SHA256:key')
    expect((await store.getResolved(created.id))?.password).toBe('next')

    const kept = await store.update(created.id, draft({ name: 'Kept', password: undefined }))
    expect(kept.hasPassword).toBe(true)
    expect((await store.getResolved(created.id))?.password).toBe('next')

    const cleared = await store.update(created.id, draft({ name: 'Cleared', password: undefined, clearPassword: true, clearPassphrase: true, askPassword: true }))
    expect(cleared.hasPassword).toBe(false)
    expect(cleared.hasPassphrase).toBe(false)
    expect(cleared.hostKey).toBe('SHA256:key')

    await expect(store.update(created.id, draft({ name: 'No password', password: undefined, clearPassword: true }))).rejects.toThrow('Введите новый пароль')
  })

  it('сохраняет hostKey, если он не передан при обновлении', async () => {
    const created = await store.create(draft({ hostKey: 'SHA256:old' }))
    const updated = await store.update(created.id, draft({ name: 'Same' }))
    expect(updated.hostKey).toBe('SHA256:old')
  })

  it('удаляет профиль и отвязывает дочерние', async () => {
    const parent = await store.create(draft({ name: 'Parent' }))
    const child = await store.create(draft({ name: 'Child', jumpProfileId: parent.id }))
    await store.remove(parent.id)
    const profiles = await store.list()
    const remaining = profiles.find((p) => p.id === child.id)
    expect(remaining?.jumpProfileId).toBeUndefined()
    await expect(store.remove('missing')).rejects.toThrow('Не найдено')
  })

  it('создаёт копию профиля с новыми id туннелей', async () => {
    const created = await store.create(draft({ tunnels: [tunnel()] }))
    const copy = await store.duplicate(created.id)
    expect(copy.id).not.toBe(created.id)
    expect(copy.name).toBe(`${created.name} (копия)`)
    expect(copy.tunnels[0].id).not.toBe(created.tunnels[0].id)
    expect(copy.lastUsedAt).toBeUndefined()
    await expect(store.duplicate('missing')).rejects.toThrow('Не найдено')
  })

  it('экспортирует профили без секретов', async () => {
    await store.create(draft({ passphrase: 'phrase', proxyType: 'http', proxyHost: 'proxy', proxyPort: 8080, proxyPassword: 'proxy-secret' }))
    const json = await store.exportProfiles()
    expect(json).not.toContain('secret')
    const exported = JSON.parse(json) as { profiles: Array<Record<string, unknown>> }
    expect(exported.profiles).toHaveLength(1)
    expect(exported.profiles[0]).not.toHaveProperty('password')
    expect(exported.profiles[0]).not.toHaveProperty('passphrase')
    expect(exported.profiles[0]).not.toHaveProperty('proxyPassword')
  })

  it('импортирует профили с новыми id и jump-связями', async () => {
    const existing = await store.create(draft({ name: 'Existing' }))
    const payload = {
      version: 1,
      profiles: [
        { ...draft({ name: 'Imported' }), id: 'old-1', password: undefined, passphrase: undefined, proxyPassword: undefined },
        { ...draft({ name: 'Imported Child' }), id: 'old-2', jumpProfileId: 'old-1', password: undefined },
        { ...draft({ name: 'Uses existing' }), id: 'old-3', jumpProfileId: existing.id, password: undefined }
      ]
    }
    await store.importProfiles(JSON.stringify(payload))
    const profiles = await store.list()
    expect(profiles).toHaveLength(4)
    const imported = profiles.find((p) => p.name === 'Imported')!
    const child = profiles.find((p) => p.name === 'Imported Child')!
    const usesExisting = profiles.find((p) => p.name === 'Uses existing')!
    expect(imported.id).not.toBe('old-1')
    expect(child.jumpProfileId).toBe(imported.id)
    expect(usesExisting.jumpProfileId).toBe(existing.id)
  })

  it('уникализирует повторяющиеся id при импорте', async () => {
    const payload = {
      version: 1,
      profiles: [
        { ...draft({ name: 'One' }), id: 'dup', password: undefined },
        { ...draft({ name: 'Two' }), id: 'dup', password: undefined }
      ]
    }
    await store.importProfiles(JSON.stringify(payload))
    const profiles = await store.list()
    expect(profiles).toHaveLength(2)
    expect(profiles[0].id).not.toBe(profiles[1].id)
  })

  it('отклоняет некорректный импорт и откатывает изменения', async () => {
    await expect(store.importProfiles('{bad')).rejects.toThrow('Неверный формат файла профилей')
    await expect(store.importProfiles('{}')).rejects.toThrow('Неверный формат файла профилей')
    await expect(store.importProfiles(JSON.stringify({ profiles: [null] }))).rejects.toThrow('Неверный формат профиля')
    await expect(store.importProfiles(JSON.stringify({ profiles: [{ id: 'x', name: '' }] }))).rejects.toThrow('Укажите название')
    await expect(store.importProfiles(JSON.stringify({ profiles: [{ ...draft(), id: 'x', jumpProfileId: 'missing', password: undefined }] })))
      .rejects.toThrow('Jump-хост «missing» не найден')

    const cycle = {
      profiles: [
        { ...draft({ name: 'A' }), id: 'a', jumpProfileId: 'b', password: undefined },
        { ...draft({ name: 'B' }), id: 'b', jumpProfileId: 'a', password: undefined }
      ]
    }
    await expect(store.importProfiles(JSON.stringify(cycle))).rejects.toThrow('зациклена')
    expect(await store.list()).toEqual([])
  })

  it('обновляет lastUsedAt', async () => {
    const created = await store.create(draft())
    expect(created.lastUsedAt).toBeUndefined()
    await store.touch(created.id)
    const list = await store.list()
    expect(list[0].lastUsedAt).toBeTruthy()
    await expect(store.touch('missing')).resolves.toBeUndefined()
  })

  it('пробрасывает ошибку записи', async () => {
    const target = join(dir, 'directory')
    await mkdir(target)
    const broken = new ProfileStore(target)
    await expect(broken.create(draft())).rejects.toBeTruthy()
  })
})
