import { useEffect } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Loader2, TriangleAlert, X } from 'lucide-react'
import type { FileTransfer } from '../types'
import { formatBytes } from '../utils'

interface TransferListProps {
  transfers: FileTransfer[]
  onDismiss: (transferId: string) => void
  onCancel: (transferId: string) => void
}

function TransferItem({
  transfer,
  onDismiss,
  onCancel
}: {
  transfer: FileTransfer
  onDismiss: (id: string) => void
  onCancel: (id: string) => void
}): JSX.Element {
  useEffect(() => {
    if (transfer.done && !transfer.error) {
      const id = window.setTimeout(() => onDismiss(transfer.transferId), 3200)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [transfer.done, transfer.error, transfer.transferId, onDismiss])

  const percent =
    transfer.totalBytes > 0
      ? Math.min(100, Math.round((transfer.bytesTransferred / transfer.totalBytes) * 100))
      : transfer.done
        ? 100
        : 0
  const uploading = transfer.direction === 'upload'
  const Icon = transfer.error ? TriangleAlert : (!transfer.done ? Loader2 : (uploading ? ArrowUpFromLine : ArrowDownToLine))
  const title = uploading ? 'Загрузка на сервер' : 'Скачивание с сервера'
  const active = !transfer.done

  return (
    <div className={`transfer-item ${active ? 'is-active' : ''} ${transfer.error ? 'is-error' : ''}`}>
      <span className="transfer-icon">
        <Icon size={16} className={active ? 'spin' : undefined} />
      </span>
      <div className="transfer-body">
        <div className="transfer-head">
          <span className="transfer-name" title={transfer.fileName}>
            {transfer.fileName}
          </span>
          <span className="transfer-percent">
            {transfer.error ? 'Ошибка' : transfer.done ? 'Готово' : `${percent}%`}
          </span>
        </div>
        <div className="transfer-progress">
          <span
            className="transfer-progress-bar"
            style={{ width: `${transfer.error ? 100 : percent}%` }}
          />
        </div>
        <div className="transfer-meta">
          <span>{title}</span>
          <span>
            {formatBytes(transfer.bytesTransferred)}
            {transfer.totalBytes > 0 ? ` из ${formatBytes(transfer.totalBytes)}` : ''}
          </span>
        </div>
        {transfer.error && <span className="transfer-error">{transfer.error}</span>}
      </div>
      <button
        type="button"
        className="transfer-close"
        onClick={() => active ? onCancel(transfer.transferId) : onDismiss(transfer.transferId)}
        aria-label={active ? 'Отменить' : 'Убрать'}
        title={active ? 'Отменить' : 'Убрать'}
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function TransferList({ transfers, onDismiss, onCancel }: TransferListProps): JSX.Element | null {
  if (transfers.length === 0) return null
  return (
    <div className="transfer-list" aria-live="polite">
      {transfers.map((transfer) => (
        <TransferItem key={transfer.transferId} transfer={transfer} onDismiss={onDismiss} onCancel={onCancel} />
      ))}
    </div>
  )
}