import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import type { ToastMessage } from '../types'

interface ToastsProps {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}

function ToastItem({
  toast,
  onDismiss
}: {
  toast: ToastMessage
  onDismiss: (id: string) => void
}): JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 4600)
    return () => window.clearTimeout(timer)
  }, [toast.id, onDismiss])

  const Icon =
    toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertTriangle : Info

  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      <span className="toast-icon">
        <Icon size={17} />
      </span>
      <span className="toast-copy">
        <strong>{toast.title}</strong>
        {toast.description && <span>{toast.description}</span>}
      </span>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Закрыть уведомление"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function Toasts({ toasts, onDismiss }: ToastsProps): JSX.Element {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
