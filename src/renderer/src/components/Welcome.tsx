import {
  ArrowRight,
  ClipboardPaste,
  Command,
  KeyRound,
  LockKeyhole,
  MousePointer2,
  Network,
  Play,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Waypoints
} from 'lucide-react'
import type { ConnectionProfile } from '@shared/types'
import type { SessionTab } from '../types'
import { avatarGradient, initials, profileSubtitle } from '../utils'

interface WelcomeProps {
  profiles: ConnectionProfile[]
  sessions: SessionTab[]
  onConnect: (profile: ConnectionProfile) => void
  onNew: () => void
}

export function Welcome({ profiles, sessions, onConnect, onNew }: WelcomeProps): JSX.Element {
  const recent = [...profiles]
    .sort((first, second) => {
      const firstDate = first.lastUsedAt ?? first.updatedAt
      const secondDate = second.lastUsedAt ?? second.updatedAt
      return secondDate.localeCompare(firstDate)
    })
    .slice(0, 5)
  const tunnelCount = profiles.reduce((total, profile) => total + profile.tunnels.length, 0)
  const quickTarget = recent[0]

  return (
    <div className="welcome">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Sparkles size={13} />
            SSH workspace
          </span>
          <h1>
            Серверы, туннели и терминал
            <span>в одном окне.</span>
          </h1>
          <p>
            Сохраняйте неограниченное число подключений, соединяйтесь через bastion-хосты и
            управляйте портами без переключения между утилитами.
          </p>
          <div className="hero-actions">
            <button type="button" className="button button-primary" onClick={onNew}>
              <Plus size={16} />
              Новое подключение
            </button>
            {quickTarget && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => onConnect(quickTarget)}
              >
                <Play size={14} fill="currentColor" />
                {quickTarget.name}
              </button>
            )}
          </div>
          <div className="hero-stats">
            <div>
              <strong>{profiles.length}</strong>
              <span>подключений</span>
            </div>
            <div>
              <strong>{tunnelCount}</strong>
              <span>туннелей</span>
            </div>
            <div>
              <strong>{sessions.length}</strong>
              <span>открытых сессий</span>
            </div>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="hero-window">
            <div className="hero-window-bar">
              <span className="hero-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="hero-window-path">deploy@prod-eu-1 — zsh</span>
              <span className="hero-window-live">
                <span className="live-dot" />
                live
              </span>
            </div>
            <div className="hero-window-body">
              <p>
                <span className="terminal-prompt">$</span> ssh deploy@prod-eu-1
              </p>
              <p className="terminal-dim">
                Last login: today from 10.10.0.4 via bastion-eu
              </p>
              <p>
                <span className="terminal-ok">●</span> secure channel established
                <span className="terminal-chip">
                  <Waypoints size={10} /> ProxyJump
                </span>
              </p>
              <p>
                <span className="terminal-prompt">$</span> docker compose ps
              </p>
              <p className="terminal-output">
                api <span>running</span> 127.0.0.1:8080
              </p>
              <p className="terminal-output">
                worker <span>running</span> 4 replicas
              </p>
              <p>
                <span className="terminal-prompt">$</span>
                <span className="terminal-cursor" />
              </p>
            </div>
            <div className="hero-window-foot">
              <span>
                <Network size={12} /> SOCKS5 :1080
              </span>
              <span>
                <LockKeyhole size={12} /> encrypted
              </span>
              <span>
                <Server size={12} /> 3 hops
              </span>
            </div>
          </div>
          <div className="hero-orbit hero-orbit-one" />
          <div className="hero-orbit hero-orbit-two" />
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="welcome-card quick-card">
          <header className="welcome-card-header">
            <div>
              <span className="section-kicker">Быстрый доступ</span>
              <h2>Сохранённые подключения</h2>
            </div>
            <button type="button" className="text-button" onClick={onNew}>
              <Plus size={14} />
              Добавить
            </button>
          </header>

          {recent.length > 0 ? (
            <div className="quick-list">
              {recent.map((profile) => (
                <button
                  type="button"
                  className="quick-row"
                  key={profile.id}
                  onClick={() => onConnect(profile)}
                >
                  <span
                    className="connection-avatar"
                    style={{ background: avatarGradient(profile.name) }}
                  >
                    {initials(profile.name)}
                  </span>
                  <span className="quick-copy">
                    <span className="quick-name">
                      {profile.name}
                      {profile.jumpProfileId && (
                        <span className="jump-mark" title="Через jump-хост">
                          <Waypoints size={11} />
                        </span>
                      )}
                    </span>
                    <span className="quick-host">{profileSubtitle(profile)}</span>
                  </span>
                  <span className="quick-meta">
                    {profile.tunnels.length > 0 && (
                      <span className="mini-chip">
                        <Network size={11} />
                        {profile.tunnels.length}
                      </span>
                    )}
                    <span className="quick-connect">
                      <Play size={13} fill="currentColor" />
                    </span>
                  </span>
                </button>
              ))}
              {profiles.length > recent.length && (
                <span className="quick-more">
                  Ещё {profiles.length - recent.length} в боковой панели
                </span>
              )}
            </div>
          ) : (
            <div className="welcome-empty">
              <span className="welcome-empty-icon">
                <Server size={23} />
              </span>
              <div>
                <h3>Добавьте первый сервер</h3>
                <p>Профили хранятся локально. Пароль или ключ можно изменить в любой момент.</p>
              </div>
              <button type="button" className="button button-primary" onClick={onNew}>
                <Plus size={16} />
                Создать подключение
              </button>
            </div>
          )}
        </div>

        <div className="welcome-card feature-card">
          <header className="welcome-card-header">
            <div>
              <span className="section-kicker">Терминал</span>
              <h2>Без компромиссов</h2>
            </div>
            <span className="feature-badge">
              <Command size={12} />
              TTY
            </span>
          </header>
          <ul className="feature-list">
            <li>
              <span className="feature-icon">
                <MousePointer2 size={16} />
              </span>
              <span>
                <strong>Мышь и TUI</strong>
                <small>Полная поддержка mouse-протоколов: mc, htop, vim и другие.</small>
              </span>
            </li>
            <li>
              <span className="feature-icon">
                <ClipboardPaste size={16} />
              </span>
              <span>
                <strong>Копирование и вставка</strong>
                <small>
                  Выделение мышью, Ctrl+Shift+C/V и bracketed paste без потери переносов.
                </small>
              </span>
            </li>
            <li>
              <span className="feature-icon">
                <KeyRound size={16} />
              </span>
              <span>
                <strong>Пароли и ключи</strong>
                <small>Шифрование через системное хранилище Windows.</small>
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="capability-strip">
        <div className="capability">
          <span>
            <Waypoints size={16} />
          </span>
          <div>
            <strong>Цепочки серверов</strong>
            <p>Подключайтесь через один или несколько jump-хостов.</p>
          </div>
          <ArrowRight size={15} className="capability-arrow" />
        </div>
        <div className="capability">
          <span>
            <Network size={16} />
          </span>
          <div>
            <strong>Туннели</strong>
            <p>Локальные, удалённые и SOCKS5-прокси с автозапуском.</p>
          </div>
          <ArrowRight size={15} className="capability-arrow" />
        </div>
        <div className="capability">
          <span>
            <ShieldCheck size={16} />
          </span>
          <div>
            <strong>Данные локально</strong>
            <p>Без облака и синхронизации. Только ваш компьютер.</p>
          </div>
          <ArrowRight size={15} className="capability-arrow" />
        </div>
      </section>

      <div className="welcome-hint">
        <MousePointer2 size={14} />
        <span>
          В приложениях с мышью удерживайте <kbd>Shift</kbd> для выделения текста. Вставка
          многострочного текста сохраняет структуру.
        </span>
      </div>
    </div>
  )
}
