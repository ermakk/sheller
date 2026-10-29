import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Download,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  Waypoints,
  X
} from 'lucide-react'
import type { ConnectionProfile } from '@shared/types'
import type { SessionTab } from '../types'
import { avatarGradient, initials, profileSubtitle } from '../utils'

interface SidebarProps {
  profiles: ConnectionProfile[]
  sessions: SessionTab[]
  loading: boolean
  onConnect: (profile: ConnectionProfile) => void
  onNew: () => void
  onEdit: (profile: ConnectionProfile) => void
  onExport: () => void
  onImport: () => void
}

interface ProfileGroup {
  name: string
  profiles: ConnectionProfile[]
}

export function Sidebar({
  profiles,
  sessions,
  loading,
  onConnect,
  onNew,
  onEdit,
  onExport,
  onImport
}: SidebarProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      if (document.querySelector('[aria-modal="true"]')) return
      const element = document.activeElement as HTMLElement | null
      if (element?.closest('.xterm')) return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const activity = useMemo(() => {
    const map = new Map<string, number>()
    for (const session of sessions) {
      if (session.status !== 'connected' && session.status !== 'connecting') continue
      map.set(session.profile.id, (map.get(session.profile.id) ?? 0) + 1)
    }
    return map
  }, [sessions])

  const groups = useMemo<ProfileGroup[]>(() => {
    const normalized = query.trim().toLowerCase()
    const visible = profiles
      .filter((profile) => {
        if (!normalized) return true
        return [profile.name, profile.host, profile.username, profile.group]
          .join(' ')
          .toLowerCase()
          .includes(normalized)
      })
      .sort((first, second) => first.name.localeCompare(second.name, 'ru'))

    const map = new Map<string, ConnectionProfile[]>()
    for (const profile of visible) {
      const group = profile.group.trim()
      const list = map.get(group) ?? []
      list.push(profile)
      map.set(group, list)
    }
    return Array.from(map.entries())
      .map(([name, items]) => ({ name, profiles: items }))
      .sort((first, second) => {
        if (!first.name) return 1
        if (!second.name) return -1
        return first.name.localeCompare(second.name, 'ru')
      })
  }, [profiles, query])

  const hasNamedGroups = groups.some((group) => group.name)
  const totalVisible = groups.reduce((total, group) => total + group.profiles.length, 0)
  const searching = query.trim().length > 0

  const toggleGroup = (name: string): void => {
    const key = name || '__ungrouped'
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="search-field">
          <Search size={15} className="search-icon" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
            placeholder="Поиск подключений"
            aria-label="Поиск подключений"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
              aria-label="Очистить поиск"
            >
              <X size={13} />
            </button>
          ) : (
            <kbd className="search-kbd">Ctrl K</kbd>
          )}
        </div>
        <button type="button" className="new-connection-button" onClick={onNew}>
          <Plus size={17} strokeWidth={2.4} />
          Новое подключение
        </button>
      </div>

      <div className="sidebar-scroll">
        {loading && (
          <div className="connection-skeletons" aria-label="Загрузка подключений">
            {[0, 1, 2, 3].map((item) => (
              <div className="connection-skeleton" key={item}>
                <span className="skeleton-avatar" />
                <span className="skeleton-lines">
                  <span />
                  <span />
                </span>
              </div>
            ))}
          </div>
        )}

        {!loading && profiles.length === 0 && (
          <div className="sidebar-empty">
            <div className="sidebar-empty-icon">
              <ShieldCheck size={20} />
            </div>
            <strong>Пока пусто</strong>
            <span>Добавьте первый сервер, чтобы начать работу.</span>
          </div>
        )}

        {!loading &&
          profiles.length > 0 &&
          groups.map((group) => {
            const key = group.name || '__ungrouped'
            const isCollapsed = !searching && collapsed.has(key)
            const groupLabel = group.name || (hasNamedGroups ? 'Без группы' : 'Все подключения')
            return (
              <section className="connection-group" key={key}>
                <button
                  type="button"
                  className="connection-group-heading"
                  onClick={() => toggleGroup(group.name)}
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span>{groupLabel}</span>
                  <span className="group-count">{group.profiles.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="connection-list">
                    {group.profiles.map((profile) => {
                      const activeCount = activity.get(profile.id) ?? 0
                      return (
                        <div className="connection-row" key={profile.id}>
                          <button
                            type="button"
                            className="connection-main"
                            onClick={() => onConnect(profile)}
                            title={`Открыть сессию ${profile.name}`}
                          >
                            <span
                              className="connection-avatar"
                              style={{ background: avatarGradient(profile.name) }}
                            >
                              {initials(profile.name)}
                              {activeCount > 0 && <span className="connection-live-dot" />}
                            </span>
                            <span className="connection-copy">
                              <span className="connection-name">
                                {profile.name}
                                {profile.jumpProfileId && (
                                  <span className="jump-mark" title="Подключение через jump-хост">
                                    <Waypoints size={11} />
                                  </span>
                                )}
                              </span>
                              <span className="connection-subtitle">
                                {profileSubtitle(profile)}
                              </span>
                            </span>
                            <span className="connection-play">
                              <Play size={13} fill="currentColor" />
                            </span>
                          </button>
                          <button
                            type="button"
                            className="connection-edit"
                            onClick={() => onEdit(profile)}
                            title="Изменить подключение"
                            aria-label={`Изменить ${profile.name}`}
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}

        {!loading && profiles.length > 0 && totalVisible === 0 && (
          <div className="sidebar-empty">
            <strong>Ничего не найдено</strong>
            <span>Попробуйте изменить запрос.</span>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <span className="sidebar-security">
          <ShieldCheck size={14} />
          <span>
            <strong>Локальное хранилище</strong>
            <small>Пароли хранятся на компьютере</small>
          </span>
        </span>
        <div className="sidebar-footer-actions">
          <button type="button" className="sidebar-footer-button" onClick={onImport} title="Импортировать профили" aria-label="Импортировать профили"><Upload size={13} /></button>
          <button type="button" className="sidebar-footer-button" onClick={onExport} title="Экспортировать профили" aria-label="Экспортировать профили"><Download size={13} /></button>
        </div>
        <span className="sidebar-total">{profiles.length}</span>
      </div>
    </aside>
  )
}
