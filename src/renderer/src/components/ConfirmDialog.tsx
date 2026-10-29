import { createPortal } from 'react-dom'
import { Loader2, Trash2, X } from 'lucide-react'

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  return createPortal(
    <div className="modal-backdrop confirm-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="modal-icon-button confirm-close"
          onClick={onCancel}
          disabled={busy}
          aria-label="Закрыть"
        >
          <X size={17} />
        </button>
        <span className="confirm-danger-icon">
          <Trash2 size={21} />
        </span>
        <h2 id="confirm-title">{title}</h2>
        <p>{description}</p>
        <div className="confirm-actions">
          <button type="button" className="button button-ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
