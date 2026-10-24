import {
  ArrowRight,
  Loader2,
  Network,
  Play,
  Settings2,
  Square,
  Waypoints,
  X,
  Zap
} from 'lucide-react'
import type { TunnelRuntime } from '@shared/types'
import { TUNNEL_LABELS } from '@shared/types'
import type { SessionTab } from '../types'
import { endpoint } from '../utils'

interface TunnelPanelProps {
  session: SessionTab
  onClose: () => void
  onEditProfile: () => void
  onStartTunnel: (tunnelId: string) => void
  onStopTunnel: (tunnelId: string) => void
}

function stateLabel(status: TunnelRuntime['status']): string {
  if (status === 'running') return 'Активен'
  if (status === 'starting') return 'Запуск'
  if (status === 'error') return 'Ошибка'
  return 'Остановлен'
}

function TunnelCard({
  tunnel,
  sessionStatus,
  onStart,
  onStop
}: {
  tunnel: TunnelRuntime
  sessionStatus: SessionTab['status']
  onStart: () => void
  onStop: () => void
}): JSX.Element {
  const connected = sessionStatus === 'connected'
  const starting = tunnel.status === 'starting'
  const running = tunnel.status === 'running'
  const activePort = tunnel.boundPort ?? tunnel.bindPort
  const bind = endpoint(tunnel.boundHost || tunnel.bindHost, activePort)
  const target = endpoint(tunnel.destHost, tunnel.destPort)

  return (
    <article className={`tunnel-card tunnel-${tunnel.status}`}>
      <header className="tunnel-card-head">
        <span className={`tunnel-type tunnel-type-${tunnel.type}`}>
          {tunnel.type === 'dynamic' ? <Network size={12} /> : <Waypoints size={12} />}
          {TUNNEL_LABELS[tunnel.type]}
        </span>
        {tunnel.autoStart && (
          <span className="tunnel-auto">
            <Zap size={10} />
            авто
          </span>
        )}
        <span className={`tunnel-state tunnel-state-${tunnel.status}`}>
          {starting && <Loader2 size={11} className="spin" />}
          <i />
          {stateLabel(tunnel.status)}
        </span>
      </header>
      <h3>{tunnel.name}</h3>
      {tunnel.type === 'dynamic' ? (
        <div className="tunnel-route tunnel-route-single">
          <span className="tunnel-route-label">SOCKS5 на этом компьютере</span>
          <code>{bind}</code>
        </div>
      ) : (
        <div className="tunnel-route">
          <div>
            <span className="tunnel-route-label">
              {tunnel.type === 'remote' ? 'На сервере' : 'Локально'}
            </span>
            <code>{bind}</code>
          </div>
          <ArrowRight size={14} />
          <div>
            <span className="tunnel-route-label">
              {tunnel.type === 'remote' ? 'На этом ПК' : 'Назначение'}
            </span>
            <code>{target}</code>
          </div>
        </div>
      )}
      {tunnel.bindPort === 0 && tunnel.status === 'running' && tunnel.boundPort && (
        <p className="tunnel-note">Выдан порт {tunnel.boundPort}</p>
      )}
      {tunnel.message && <p className="tunnel-error">{tunnel.message}</p>}
      <footer className="tunnel-card-foot">
        <span className="tunnel-description">
          {tunnel.type === 'local' && 'Принимает подключения на этом компьютере'}
          {tunnel.type === 'remote' && 'Открывает порт на удалённом сервере'}
          {tunnel.type === 'dynamic' && 'Локальный SOCKS5-прокси через SSH'}
        </span>
        <button
          type="button"
          className={`button button-small ${running ? 'button-ghost' : 'button-secondary'}`}
          onClick={running ? onStop : onStart}
          disabled={!connected || starting}
          title={!connected ? 'Сначала подключитесь к серверу' : undefined}
        >
          {starting ? (
            <Loader2 size={13} className="spin" />
          ) : running ? (
            <Square size={12} fill="currentColor" />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          {starting ? 'Запуск' : running ? 'Остановить' : 'Запустить'}
        </button>
      </footer>
    </article>
  )
}

export function TunnelPanel({
  session,
  onClose,
  onEditProfile,
  onStartTunnel,
  onStopTunnel
}: TunnelPanelProps): JSX.Element {
  const running = session.tunnels.filter((tunnel) => tunnel.status === 'running').length

  return (
    <div className="tunnel-overlay">
      <div className="tunnel-scrim" onClick={onClose} />
      <aside className="tunnel-panel" aria-label="Туннели сессии">
        <header className="tunnel-panel-header">
          <div>
            <span className="section-kicker">SSH forwarding</span>
            <h2>Туннели</h2>
            <p>
              {session.profile.name}
              <span className="dot-separator" />
              {running} из {session.tunnels.length} активны
            </p>
          </div>
          <button
            type="button"
            className="modal-icon-button"
            onClick={onClose}
            aria-label="Закрыть панель туннелей"
          >
            <X size={18} />
          </button>
        </header>

        <div className="tunnel-panel-body">
          {session.status !== 'connected' && (
            <div className="tunnel-offline">
              Подключитесь к серверу, чтобы управлять туннелями.
            </div>
          )}
          {session.tunnels.length === 0 ? (
            <div className="tunnel-empty">
              <span>
                <Network size={24} />
              </span>
              <h3>Туннелей пока нет</h3>
              <p>
                Добавьте локальный, удалённый порт или SOCKS5-прокси в настройках подключения.
              </p>
              <button type="button" className="button button-secondary" onClick={onEditProfile}>
                <Settings2 size={14} />
                Настроить
              </button>
            </div>
          ) : (
            <div className="tunnel-list">
              {session.tunnels.map((tunnel) => (
                <TunnelCard
                  key={tunnel.id}
                  tunnel={tunnel}
                  sessionStatus={session.status}
                  onStart={() => onStartTunnel(tunnel.id)}
                  onStop={() => onStopTunnel(tunnel.id)}
                />
              ))}
            </div>
          )}
        </div>

        <footer className="tunnel-panel-footer">
          <span>
            <ShieldMark />
            Трафик туннелей идёт внутри SSH-соединения
          </span>
          <button type="button" className="text-button" onClick={onEditProfile}>
            <Settings2 size={14} />
            Настройки подключения
          </button>
        </footer>
      </aside>
    </div>
  )
}

function ShieldMark(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 5 6v5c0 4.4 2.9 8.5 7 10 4.1-1.5 7-5.6 7-10V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}
