import { useEffect, useState } from 'react'
import { SquareTerminal, CornerDownLeft } from 'lucide-react'
import type { ConnectionProfile } from '@shared/types'
import { TerminalPane } from './components/TerminalPane'
import type { SessionTab } from './types'

interface DetachedAppProps {
  sessionId: string
  profileId: string
}

export default function DetachedApp({ sessionId, profileId }: DetachedAppProps): JSX.Element | null {
  const [profile, setProfile] = useState<ConnectionProfile | null>(null)
  const [status, setStatus] = useState<SessionTab['status']>('connected')
  const [message, setMessage] = useState<string | undefined>()

  useEffect(() => {
    void window.sheller.profiles.list().then((list) => {
      setProfile(list.find((p) => p.id === profileId) ?? null)
    })
  }, [profileId])

  useEffect(() => {
    const unsub = window.sheller.events.onStatus((event) => {
      if (event.sessionId === sessionId) {
        setStatus(event.status)
        setMessage(event.message)
      }
    })
    return () => unsub()
  }, [sessionId])

  if (!profile) return null

  const session: SessionTab = { id: sessionId, profile, status, message, tunnels: [] }

  return (
    <div className="detached-shell">
      <header className="detached-titlebar">
        <div className="detached-brand">
          <span className="brand-logo" style={{ width: 20, height: 20, borderRadius: 6 }}>
            <SquareTerminal size={12} strokeWidth={2.1} />
          </span>
          <span className="detached-name">{profile.name}</span>
          <span className="detached-host">{profile.username}@{profile.host}</span>
        </div>
        <div className="detached-actions">
          <button
            type="button"
            className="detached-action-btn"
            onClick={() => window.sheller.sessions.attach(sessionId, profileId)}
            title="Вернуть в главное окно"
          >
            <CornerDownLeft size={15} />
          </button>
        </div>
      </header>
      
      <div className="detached-content">
        <TerminalPane
          session={session}
          active={true}
          autoConnect={true}
          autoFocus={true}
          onReconnect={() => {}}
          onClose={() => window.close()}
          onFilesDropped={() => {}}
        />
      </div>
    </div>
  )
}