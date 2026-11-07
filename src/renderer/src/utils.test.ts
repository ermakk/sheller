import { describe, expect, it } from 'vitest'
import type { TunnelRuntime } from '@shared/types'
import {
  avatarGradient,
  endpoint,
  errorMessage,
  formatBytes,
  initials,
  profileSubtitle,
  runningTunnels,
  statusLabel,
  tunnelRoute
} from './utils'

function tunnel(overrides: Partial<TunnelRuntime> = {}): TunnelRuntime {
  return {
    id: 't1',
    name: 'Tunnel',
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

describe('avatarGradient', () => {
  it('стабильно выбирает градиент по строке', () => {
    expect(avatarGradient('Production')).toBe(avatarGradient('Production'))
    expect(avatarGradient('Production')).toMatch(/^linear-gradient/)
    expect(avatarGradient('')).toMatch(/^linear-gradient/)
  })
})

describe('initials', () => {
  it('возвращает SSH для пустого имени', () => {
    expect(initials('')).toBe('SSH')
    expect(initials('   ')).toBe('SSH')
  })

  it('берёт две первые буквы одного слова', () => {
    expect(initials('production')).toBe('PR')
    expect(initials('a')).toBe('A')
  })

  it('берёт первые буквы двух слов', () => {
    expect(initials('Production API')).toBe('PA')
    expect(initials('  my   server  ')).toBe('MS')
  })
})

describe('profileSubtitle', () => {
  it('не добавляет порт 22', () => {
    expect(profileSubtitle({ username: 'root', host: 'example.com', port: 22 })).toBe('root@example.com')
  })

  it('добавляет нестандартный порт', () => {
    expect(profileSubtitle({ username: 'root', host: 'example.com', port: 2222 })).toBe('root@example.com:2222')
  })
})

describe('statusLabel', () => {
  it('переводит статусы на русский', () => {
    expect(statusLabel('connected')).toBe('Подключено')
    expect(statusLabel('connecting')).toBe('Подключение')
    expect(statusLabel('error')).toBe('Ошибка')
    expect(statusLabel('disconnected')).toBe('Отключено')
  })
})

describe('endpoint', () => {
  it('подставляет localhost и форматирует порт', () => {
    expect(endpoint(undefined, undefined)).toBe('127.0.0.1')
    expect(endpoint('', 80)).toBe('127.0.0.1:80')
    expect(endpoint('example.com', 0)).toBe('example.com:0')
  })
})

describe('tunnelRoute', () => {
  it('возвращает только адрес для dynamic', () => {
    expect(tunnelRoute(tunnel({ type: 'dynamic', bindPort: 1080 }))).toBe('127.0.0.1:1080')
  })

  it('использует boundHost и boundPort', () => {
    expect(tunnelRoute(tunnel({ boundHost: '0.0.0.0', boundPort: 9000, destHost: 'db', destPort: 5432 })))
      .toBe('0.0.0.0:9000  →  db:5432')
  })

  it('подставляет адрес по умолчанию для назначения', () => {
    expect(tunnelRoute(tunnel({ destHost: undefined, destPort: undefined })))
      .toBe('127.0.0.1:8080  →  127.0.0.1')
  })
})

describe('runningTunnels', () => {
  it('считает только running', () => {
    expect(runningTunnels([])).toBe(0)
    expect(runningTunnels([tunnel({ status: 'running' }), tunnel({ status: 'error' }), tunnel({ status: 'running' })])).toBe(2)
  })
})

describe('errorMessage', () => {
  it('извлекает сообщение из Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('приводит прочие значения к строке', () => {
    expect(errorMessage('fail')).toBe('fail')
    expect(errorMessage(42)).toBe('42')
  })
})

describe('formatBytes', () => {
  it('форматирует байты и некорректные значения', () => {
    expect(formatBytes(Number.NaN)).toBe('0 Б')
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(-5)).toBe('0 Б')
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(2048)).toBe('2.0 КБ')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 МБ')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 ГБ')
  })
})
