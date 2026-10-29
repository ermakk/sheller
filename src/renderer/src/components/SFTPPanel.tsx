import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Folder, File, ArrowUp, Download, Upload, Trash, RefreshCw, X } from 'lucide-react'
import type { SessionTab } from '../types'
import type { RemoteFile } from '@shared/types'
import { ConfirmDialog } from './ConfirmDialog'
import { errorMessage, formatBytes } from '../utils'

export function SFTPPanel({ session, onClose }: { session: SessionTab; onClose: () => void }) {
  const [path, setPath] = useState('~')
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RemoteFile | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async (p: string) => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.sheller.files.listRemote(session.id, p)
      setFiles(list.sort((a,b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : (a.isDirectory ? -1 : 1)))
      setPath(p)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [session.id])

  useEffect(() => { void load('~') }, [load])

  const handleUp = () => {
    if (path === '/' || path === '~') return
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    void load(parts.length ? `/${parts.join('/')}` : '/')
  }

  const handleDownload = async (file: RemoteFile) => {
    if (file.isDirectory) return
    const localDir = await window.sheller.files.pickDownload()
    if (!localDir) return
    void window.sheller.files.download(session.id, file.path, localDir, crypto.randomUUID())
  }

  const handleUpload = async () => {
    const paths = await window.sheller.files.pickUpload('file')
    for (const p of paths) {
      void window.sheller.files.upload(session.id, p, path, crypto.randomUUID())
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    try {
      const result = await window.sheller.files.deleteRemote(session.id, deleteTarget.path)
      if (!result.ok) {
        setError(result.error ?? 'Не удалось удалить файл')
        return
      }
      setDeleteTarget(null)
      await load(path)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="sftp-panel">
      <header className="sftp-header">
        <span>SFTP: {session.profile.name}</span>
        <button className="modal-icon-button" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="sftp-toolbar">
        <button onClick={handleUp} disabled={path === '/' || path === '~'}><ArrowUp size={16} /></button>
        <button onClick={() => load(path)} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
        <button onClick={handleUpload}><Upload size={16} /></button>
        <span className="sftp-path">{path}</span>
      </div>
      {error && (
        <div className="sftp-error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Закрыть"><X size={12} /></button>
        </div>
      )}
      <div className="sftp-list">
        {files.map(f => (
          <div key={f.path} className="sftp-item" onDoubleClick={() => f.isDirectory && load(f.path)}>
            {f.isDirectory ? <Folder size={16} /> : <File size={16} />}
            <span>{f.name}</span>
            {!f.isDirectory && <span className="size">{formatBytes(f.size)}</span>}
            <div className="actions">
              {!f.isDirectory && <button onClick={() => handleDownload(f)}><Download size={14} /></button>}
              <button onClick={() => setDeleteTarget(f)}><Trash size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.isDirectory ? 'Удалить папку?' : 'Удалить файл?'}
          description={`«${deleteTarget.name}»${deleteTarget.isDirectory ? ' и всё её содержимое' : ''} будет удалено без возможности восстановления.`}
          confirmLabel="Удалить"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  )
}