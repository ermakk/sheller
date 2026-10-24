import type { SessionStatus, TunnelRuntime } from '@shared/types'

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #2dd4bf, #0ea5a7)',
  'linear-gradient(135deg, #60a5fa, #4f46e5)',
  'linear-gradient(135deg, #f472b6, #a855f7)',
  'linear-gradient(135deg, #fbbf24, #f97316)',
  'linear-gradient(135deg, #a3e635, #16a34a)',
  'linear-gradient(135deg, #f87171, #dc2626)',
  'linear-gradient(135deg, #22d3ee, #2563eb)',
  'linear-gradient(135deg, #c084fc, #7c3aed)'
]

export function avatarGradient(seed: string): string {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'SSH'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

export function profileSubtitle(profile: {
  username: string
  host: string
  port: number
}): string {
  return `${profile.username}@${profile.host}${profile.port !== 22 ? `:${profile.port}` : ''}`
}

export function statusLabel(status: SessionStatus): string {
  if (status === 'connected') return 'Подключено'
  if (status === 'connecting') return 'Подключение'
  if (status === 'error') return 'Ошибка'
  return 'Отключено'
}

export function endpoint(host: string | undefined, port: number | undefined): string {
  const address = host || '127.0.0.1'
  return port === undefined ? address : `${address}:${port}`
}

export function tunnelRoute(tunnel: TunnelRuntime): string {
  const activePort = tunnel.boundPort ?? tunnel.bindPort
  if (tunnel.type === 'dynamic') {
    return endpoint(tunnel.boundHost || tunnel.bindHost, activePort)
  }
  const bind = endpoint(tunnel.boundHost || tunnel.bindHost, activePort)
  const target = endpoint(tunnel.destHost, tunnel.destPort)
  return `${bind}  →  ${target}`
}

export function runningTunnels(tunnels: TunnelRuntime[]): number {
  return tunnels.filter((tunnel) => tunnel.status === 'running').length
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б'
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}