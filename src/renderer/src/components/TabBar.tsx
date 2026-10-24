import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, MoreVertical, MonitorUp, SplitSquareHorizontal } from 'lucide-react'
import type { SessionTab } from '../types'
import { avatarGradient, initials, statusLabel } from '../utils'

interface TabBarProps {
  sessions: SessionTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onDetach?: (id: string) => void
  onMerge?: (sourceId: string, targetId: string) => void
}

interface MenuState {
  sessionId: string
  x: number
  y: number
}

export function TabBar({
  sessions,
  activeId,
  onActivate,
  onClose,
  onNew,
  onDetach,
  onMerge
}: TabBarProps): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null)
      }
    }
    const handleScroll = () => setMenu(null)
    
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [menu])

  const openMenu = (sessionId: string, x: number, y: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Защита от выхода меню за край экрана
    const safeX = Math.min(x, window.innerWidth - 250)
    const safeY = Math.min(y, window.innerHeight - 200)
    setMenu({ sessionId, x: safeX, y: safeY })
    onActivate(sessionId)
  }

  const activeSessionId = menu?.sessionId
  const otherSessions = activeSessionId ? sessions.filter(s => s.id !== activeSessionId) : []

  return (
    <div className="tabbar" role="tablist" aria-label="Открытые сессии">
      <div className="tabbar-scroll">
        {sessions.map((session) => {
          const active = session.id === activeId
          return (
            <div
              key={session.id}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              className={`session-tab ${active ? 'is-active' : ''}`}
              onClick={() => onActivate(session.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onActivate(session.id)
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(session.id)
                }
              }}
              onContextMenu={(e) => openMenu(session.id, e.clientX, e.clientY, e)}
            >
              <span className="tab-avatar" style={{ background: avatarGradient(session.profile.name) }}>
                {initials(session.profile.name)}
              </span>
              <span className="tab-copy">
                <span className="tab-name">{session.profile.name}</span>
                <span className={`tab-status tab-status-${session.status}`}>
                  {statusLabel(session.status)}
                </span>
              </span>
              <span className={`tab-dot tab-dot-${session.status}`} />
              <button
                type="button"
                className="tab-menu-button"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  openMenu(session.id, rect.left, rect.bottom, e)
                }}
                title="Меню вкладки"
                aria-label="Меню вкладки"
              >
                <MoreVertical size={12} />
              </button>
              <button
                type="button"
                className="tab-close"
                title="Закрыть сессию"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(session.id)
                }}
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <button type="button" className="tab-add" onClick={onNew} title="Новое подключение">
        <Plus size={16} />
      </button>

      {menu && createPortal(
        <div
          ref={menuRef}
          className="tab-menu"
          style={{ position: 'fixed', top: menu.y, left: menu.x }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {onDetach && (
            <button
              type="button"
              onClick={() => {
                onDetach(menu.sessionId)
                setMenu(null)
              }}
            >
              <MonitorUp size={12} /> Вынести в отдельное окно
            </button>
          )}
          {onMerge && otherSessions.length > 0 && (
            <>
              <div className="tab-menu-sep" />
              <div className="tab-menu-label">
                <SplitSquareHorizontal size={11} /> Объединить с…
              </div>
              {otherSessions.map((other) => (
                <button
                  type="button"
                  key={other.id}
                  onClick={() => {
                    onMerge(menu.sessionId, other.id)
                    setMenu(null)
                  }}
                >
                  {other.profile.name}
                </button>
              ))}
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}