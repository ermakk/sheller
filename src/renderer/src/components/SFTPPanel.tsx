import { useState, useEffect, useCallback } from 'react'
import { Folder, File, ArrowUp, Download, Upload, Trash, RefreshCw, X } from 'lucide-react'
import type { SessionTab } from '../types'
import type { RemoteFile } from '@shared/types'
import { formatBytes } from '../utils'

export function SFTPPanel({ session, onClose }: { session: SessionTab; onClose: () => void }) {
  const [path, setPath] = useState('~')
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (p: string) => {
    setLoading(true)
    try {
      const list = await window.sheller.files.listRemote(session.id, p)
      setFiles(list.sort((a,b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : (a.isDirectory ? -1 : 1)))
      setPath(p)
    } catch (e) {
      alert('Ошибка: ' + e)
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

  const handleDelete = async (file: RemoteFile) => {
    if (!confirm(`Удалить ${file.name}?`)) return
    await window.sheller.files.deleteRemote(session.id, file.path)
    void load(path)
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
      <div className="sftp-list">
        {files.map(f => (
          <div key={f.path} className="sftp-item" onDoubleClick={() => f.isDirectory && load(f.path)}>
            {f.isDirectory ? <Folder size={16} /> : <File size={16} />}
            <span>{f.name}</span>
            {!f.isDirectory && <span className="size">{formatBytes(f.size)}</span>}
            <div className="actions">
              {!f.isDirectory && <button onClick={() => handleDownload(f)}><Download size={14} /></button>}
              <button onClick={() => handleDelete(f)}><Trash size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}