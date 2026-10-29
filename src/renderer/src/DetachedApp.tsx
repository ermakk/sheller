import { useEffect, useState } from 'react'
import { SquareTerminal, CornerDownLeft } from 'lucide-react'
import type { ConnectionProfile } from '@shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { PasswordPrompt } from './components/PasswordPrompt'
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
  const [connectionKey, setConnectionKey] = useState(0)
  const [pwdPrompt, setPwdPrompt] = useState(false)
  const [hostKeyPrompt, setHostKeyPrompt] = useState<{ hostKey: string; previousHostKey?: string } | null>(null)

  useEffect(() => {
    void window.sheller.profiles.list().then((list) => {
      setProfile(list.find((p) => p.id === profileId) ?? null)
    })
  }, [profileId])

  useEffect(() => {
    const unsubStatus = window.sheller.events.onStatus((event) => {
      if (event.sessionId === sessionId) {
        setStatus(event.status)
        setMessage(event.message)
      }
    })
    const unsubPassword = window.sheller.events.onRequestPassword((event) => {
      if (event.sessionId === sessionId) setPwdPrompt(true)
    })
    const unsubHostKey = window.sheller.events.onHostKeyVerify((event) => {
      if (event.sessionId === sessionId) {
        setHostKeyPrompt({ hostKey: event.hostKey, previousHostKey: event.previousHostKey })
      }
    })
    return () => { unsubStatus(); unsubPassword(); unsubHostKey() }
  }, [sessionId])

  if (!profile) return null

  const session: SessionTab = { id: sessionId, profile, status, message, tunnels: [] }
  const close = (): void => {
    void window.sheller.sessions.disconnect(sessionId)
    window.close()
  }

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
          key={connectionKey}
          session={session}
          active={true}
          autoConnect={true}
          autoFocus={true}
          onReconnect={() => { setStatus('connecting'); setConnectionKey((value) => value + 1) }}
          onClose={close}
          onFilesDropped={(paths) => {
            for (const localPath of paths) void window.sheller.files.upload(sessionId, localPath, './', crypto.randomUUID())
          }}
        />
      </div>
      {pwdPrompt && (
        <PasswordPrompt
          onConfirm={(password) => {
            window.sheller.sessions.providePassword(sessionId, password)
            setPwdPrompt(false)
          }}
          onCancel={() => {
            void window.sheller.sessions.disconnect(sessionId)
            setPwdPrompt(false)
          }}
        />
      )}
      {hostKeyPrompt && (
        <ConfirmDialog
          title={hostKeyPrompt.previousHostKey ? 'Ключ сервера изменился!' : 'Неизвестный сервер'}
          description={`Отпечаток ключа: ${hostKeyPrompt.hostKey}.${hostKeyPrompt.previousHostKey ? ' Ранее сервер использовал другой ключ — это может быть подмена сервера.' : ''} Вы доверяете этому серверу?`}
          confirmLabel="Доверять"
          onConfirm={() => {
            window.sheller.sessions.provideHostKey(sessionId, true)
            setHostKeyPrompt(null)
          }}
          onCancel={() => {
            window.sheller.sessions.provideHostKey(sessionId, false)
            setHostKeyPrompt(null)
          }}
        />
      )}
    </div>
  )
}