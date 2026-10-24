import { useState } from 'react'
import { Loader2, LockKeyhole } from 'lucide-react'

interface PasswordPromptProps {
  onConfirm: (password: string) => void
  onCancel: () => void
}

export function PasswordPrompt({ onConfirm, onCancel }: PasswordPromptProps): JSX.Element {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ textAlign: 'left' }}
      >
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Требуется пароль</h2>
        <p style={{ fontSize: 11, marginBottom: 16 }}>Введите пароль для подключения к серверу.</p>
        <div className="input-with-action" style={{ marginBottom: 16 }}>
          <input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && onConfirm(password)}
          />
          <button
            type="button"
            className="input-action"
            onClick={() => setShow((s) => !s)}
            tabIndex={-1}
          >
            {show ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        <div className="confirm-actions">
          <button type="button" className="button button-ghost" onClick={onCancel}>Отмена</button>
          <button type="button" className="button button-primary" onClick={() => onConfirm(password)}>
            <LockKeyhole size={15} />
            Войти
          </button>
        </div>
      </div>
    </div>
  )
}