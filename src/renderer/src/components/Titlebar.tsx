import { LockKeyhole, SquareTerminal } from 'lucide-react'

interface TitlebarProps {
  sessionCount: number
}

function sessionLabel(count: number): string {
  if (count === 1) return 'сессия'
  if (count > 1 && count < 5) return 'сессии'
  return 'сессий'
}

export function Titlebar({ sessionCount }: TitlebarProps): JSX.Element {
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-logo">
          <SquareTerminal size={16} strokeWidth={2.1} />
        </span>
        <span className="brand-name">Sheller</span>
      </div>
      <div className="titlebar-meta">
        {sessionCount > 0 && (
          <span className="titlebar-pill">
            <span className="live-dot" />
            {sessionCount} {sessionLabel(sessionCount)}
          </span>
        )}
        <span className="titlebar-pill is-muted">
          <LockKeyhole size={12} />
          локальные данные
        </span>
      </div>
    </header>
  )
}
