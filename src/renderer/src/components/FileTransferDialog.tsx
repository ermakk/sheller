import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowUp, Download, File, Folder, Loader2, X } from 'lucide-react'
import type { SessionTab } from '../types'
import type { RemoteFile } from '@shared/types'
import { formatBytes } from '../utils'

interface FileTransferDialogProps {
  session: SessionTab
  onClose: () => void
}

export function FileTransferDialog({ session, onClose }: FileTransferDialogProps): JSX.Element {
  const [currentPath, setCurrentPath] = useState('~')
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [selected, setSelected] = useState<RemoteFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    setSelected(null)
    try {
      const list = await window.sheller.files.listRemote(session.id, path)
      list.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
      setFiles(list)
      setCurrentPath(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить список файлов')
    } finally {
      setLoading(false)
    }
  }, [session.id])

  useEffect(() => {
    void loadFiles('~')
  }, [loadFiles])

  const handleUp = () => {
    if (currentPath === '/' || currentPath === '~') return
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    const parent = parts.length === 0 ? '/' : `/${parts.join('/')}`
    void loadFiles(parent)
  }

  const handleDoubleClick = (file: RemoteFile) => {
    if (file.isDirectory) {
      void loadFiles(file.path)
    }
  }

  const submit = async () => {
    if (!selected || busy) return
    const localDir = await window.sheller.files.pickDownload()
    if (!localDir) return

    setBusy(true)
    setError(null)
    const transferId = crypto.randomUUID()
    const result = await window.sheller.files.download(
      session.id,
      selected.path,
      localDir,
      transferId
    )
    setBusy(false)
    if (result.ok) {
      onClose()
    } else {
      setError(result.error ?? 'Не удалось начать скачивание')
    }
  }

  const pathParts = currentPath.split('/').filter(Boolean)
  const displayPath = currentPath.startsWith('~') ? currentPath : `/${pathParts.join('/')}` || '/'

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="file-transfer-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="file-transfer-header">
          <div>
            <span className="section-kicker">SFTP</span>
            <h2>Скачать с сервера</h2>
            <p>{session.profile.name} — {session.profile.host}</p>
          </div>
          <button type="button" className="modal-icon-button" onClick={onClose} aria-label="Закрыть" disabled={busy}>
            <X size={18} />
          </button>
        </header>

        <div className="file-browser-toolbar">
          <button type="button" className="modal-icon-button" onClick={handleUp} disabled={currentPath === '/' || currentPath === '~' || loading}>
            <ArrowUp size={16} />
          </button>
          <div className="file-browser-path" title={displayPath}>{displayPath}</div>
          {loading && <Loader2 size={16} className="spin" />}
        </div>

        <div className="file-browser-list">
          {files.map((file) => (
            <div
              key={file.path}
              className={`file-browser-item ${selected?.path === file.path ? 'is-selected' : ''} ${file.isDirectory ? 'is-dir' : 'is-file'}`}
              onClick={() => setSelected(file)}
              onDoubleClick={() => handleDoubleClick(file)}
            >
              <span className="file-browser-icon">
                {file.isDirectory ? <Folder size={16} /> : <File size={16} />}
              </span>
              <span className="file-browser-name">{file.name}</span>
              {!file.isDirectory && <span className="file-browser-size">{formatBytes(file.size)}</span>}
            </div>
          ))}
          {!loading && files.length === 0 && (
            <div className="file-browser-empty">Папка пуста</div>
          )}
        </div>

        {error && (
          <div className="file-browser-error">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        <footer className="file-transfer-footer">
          <span className="file-browser-selection">
            {selected ? `Выбрано: ${selected.name}` : 'Выберите файл или папку (двойной клик — открыть папку)'}
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" className="button button-ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="button button-primary" onClick={submit} disabled={!selected || busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            {busy ? 'Подготовка…' : 'Скачать'}
          </button>
        </footer>
      </div>
    </div>
  )
}