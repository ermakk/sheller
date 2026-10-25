import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, FolderUp, Loader2, Settings2, Waypoints, Activity } from 'lucide-react'
import type { ConnectionProfile, ProfileActionResult, ProfileDraft } from '@shared/types'
import { ConnectionModal } from './components/ConnectionModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { FileTransferDialog } from './components/FileTransferDialog'
import { PasswordPrompt } from './components/PasswordPrompt'
import { Sidebar } from './components/Sidebar'
import { SFTPPanel } from './components/SFTPPanel'
import { SnippetsPanel } from './components/SnippetsPanel'
import { CronModal } from './components/CronModal'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { Titlebar } from './components/Titlebar'
import { Toasts } from './components/Toasts'
import { TransferList } from './components/TransferList'
import { TunnelPanel } from './components/TunnelPanel'
import { UpdateBanner } from './components/UpdateBanner'
import { Welcome } from './components/Welcome'
import type { FileTransfer, SessionTab, ToastKind, ToastMessage } from './types'
import { errorMessage, profileSubtitle, runningTunnels, statusLabel } from './utils'
import { SystemMonitor } from './components/SystemMonitor'

type EditorState = { profile: ConnectionProfile | null }

export default function App(): JSX.Element {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConnectionProfile | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tunnelPanelOpen, setTunnelPanelOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [transfers, setTransfers] = useState<FileTransfer[]>([])
  const [downloadDialogSession, setDownloadDialogSession] = useState<SessionTab | null>(null)
  const [sftpPanelOpen, setSftpPanelOpen] = useState(false)
  const [snippetsPanelOpen, setSnippetsPanelOpen] = useState(false)
  const [cronModalOpen, setCronModalOpen] = useState(false)
  const [systemMonitorOpen, setSystemMonitorOpen] = useState(false)
  
  const [splitSessions, setSplitSessions] = useState<Record<string, { session: SessionTab; merged: boolean }>>({})
  const [pwdPrompt, setPwdPrompt] = useState<{ sessionId: string } | null>(null)
  const [hostKeyPrompt, setHostKeyPrompt] = useState<{ sessionId: string; hostKey: string } | null>(null)

  const profilesRef = useRef(profiles)
  useEffect(() => { profilesRef.current = profiles }, [profiles])

  const addToast = useCallback((kind: ToastKind, title: string, description?: string): void => {
    setToasts((previous) => [...previous.slice(-3), { id: crypto.randomUUID(), kind, title, description }])
  }, [])

  const dismissToast = useCallback((id: string): void => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const loadProfiles = useCallback(async (): Promise<void> => {
    try {
      const list = await window.sheller.profiles.list()
      setProfiles(list)
    } catch (error) {
      addToast('error', 'Не удалось загрузить подключения', errorMessage(error))
    }
  }, [addToast])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    void window.sheller.profiles.list().then((list) => { if (mounted) setProfiles(list) }).catch((error) => { if (mounted) addToast('error', 'Ошибка загрузки', errorMessage(error)) }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [addToast])

  useEffect(() => {
    const unsubscribeStatus = window.sheller.events.onStatus((event) => {
      setSessions((previous) => previous.map((session) => session.id === event.sessionId ? { ...session, status: event.status, message: event.message } : session))
      setSplitSessions((previous) => {
        let changed = false
        const next = { ...previous }
        for (const [parentId, entry] of Object.entries(next)) {
          if (entry.session.id === event.sessionId) {
            next[parentId] = { session: { ...entry.session, status: event.status, message: event.message }, merged: entry.merged }
            changed = true
          }
        }
        return changed ? next : previous
      })
    })
    const unsubscribeTunnels = window.sheller.events.onTunnels((event) => {
      setSessions((previous) => previous.map((session) => session.id === event.sessionId ? { ...session, tunnels: event.tunnels } : session))
    })
    const unPwd = window.sheller.events.onRequestPassword((e) => setPwdPrompt(e))
    const unKey = window.sheller.events.onHostKeyVerify((e) => setHostKeyPrompt(e))
    const unAttach = window.sheller.events.onAttach(({ sessionId, profileId }) => {
      const profile = profilesRef.current.find((p) => p.id === profileId)
      if (!profile) return
      setSessions((prev) => {
        if (prev.some((s) => s.id === sessionId)) return prev
        return [...prev, { id: sessionId, profile, status: 'connected', isAttached: true, tunnels: profile.tunnels.map((t) => ({ ...t, status: 'stopped' })) }]
      })
      setActiveSessionId(sessionId)
    })
    return () => { unsubscribeStatus(); unsubscribeTunnels(); unPwd(); unKey(); unAttach() }
  }, [])

  useEffect(() => {
    return window.sheller.events.onTransfer((event) => {
      setTransfers((previous) => {
        const index = previous.findIndex((item) => item.transferId === event.transferId)
        if (index === -1) return [...previous, event]
        const next = previous.slice()
        next[index] = event
        return next
      })
    })
  }, [])

  useEffect(() => { 
    setTunnelPanelOpen(false); 
    setSftpPanelOpen(false); 
    setSnippetsPanelOpen(false); 
    setCronModalOpen(false);    
    if (activeSession && activeSession.status !== 'connected') {
      setSystemMonitorOpen(false)
    }
  }, [activeSessionId])

  const dismissTransfer = useCallback((transferId: string) => {
    setTransfers((previous) => previous.filter((item) => item.transferId !== transferId))
  }, [])

  const activeSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) ?? null, [sessions, activeSessionId])

  const openSession = useCallback((profile: ConnectionProfile): void => {
    const sessionId = crypto.randomUUID()
    setSessions((previous) => [...previous, { id: sessionId, profile, status: 'connecting', tunnels: profile.tunnels.map((tunnel) => ({ ...tunnel, status: 'stopped' })) }])
    setActiveSessionId(sessionId)
  }, [])

  const handleSplit = useCallback(() => {
    if (!activeSession || splitSessions[activeSession.id]) return
    const newId = crypto.randomUUID()
    setSplitSessions(prev => ({ ...prev, [activeSession.id]: { session: { ...activeSession, id: newId, status: 'connecting' }, merged: false } }))
  }, [activeSession, splitSessions])

  const handleMerge = useCallback((sourceId: string, targetId: string) => {
    if (splitSessions[sourceId]) return
    const target = sessions.find(s => s.id === targetId)
    if (!target) return
    setSessions(prev => prev.filter(s => s.id !== targetId))
    setSplitSessions(prev => ({ ...prev, [sourceId]: { session: target, merged: true } }))
    setActiveSessionId(sourceId)
  }, [sessions, splitSessions])

  const handleDetach = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return
    const secondary = splitSessions[sessionId]
    if (secondary) {
      if (!secondary.merged) void window.sheller.sessions.disconnect(secondary.session.id)
      else setSessions(prev => [...prev, secondary.session])
      setSplitSessions(prev => { const n = { ...prev }; delete n[sessionId]; return n })
    }
    void window.sheller.sessions.detach(sessionId, session.profile.id)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    const index = sessions.findIndex(s => s.id === sessionId)
    const fallback = sessions[index + 1] ?? sessions[index - 1] ?? null
    setActiveSessionId(fallback?.id ?? null)
  }, [sessions, splitSessions])

  const closeSplit = useCallback(() => {
    if (!activeSession) return
    const secondary = splitSessions[activeSession.id]
    if (!secondary) return
    if (secondary.merged) setSessions(prev => [...prev, secondary.session])
    else void window.sheller.sessions.disconnect(secondary.session.id)
    setSplitSessions(prev => { const n = { ...prev }; delete n[activeSession.id]; return n })
  }, [activeSession, splitSessions])

  const closeSession = useCallback((sessionId: string) => {
    const secondary = splitSessions[sessionId]
    if (secondary) {
      if (secondary.merged) setSessions(prev => [...prev, secondary.session])
      else void window.sheller.sessions.disconnect(secondary.session.id)
      setSplitSessions(prev => { const n = { ...prev }; delete n[sessionId]; return n })
    } else {
      void window.sheller.sessions.disconnect(sessionId)
    }
    const index = sessions.findIndex(s => s.id === sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    if (activeSessionId === sessionId) {
      const fallback = sessions[index + 1] ?? sessions[index - 1] ?? null
      setActiveSessionId(fallback?.id ?? null)
    }
  }, [sessions, activeSessionId, splitSessions])

  const reconnectSession = useCallback((sessionId: string) => {
    const current = sessions.find(s => s.id === sessionId)
    if (!current) return
    const secondary = splitSessions[sessionId]
    if (secondary) {
      if (!secondary.merged) void window.sheller.sessions.disconnect(secondary.session.id)
      setSplitSessions(prev => { const n = { ...prev }; delete n[sessionId]; return n })
    }
    const latest = profiles.find(p => p.id === current.profile.id)
    if (!latest) { addToast('error', 'Профиль удалён', 'Нельзя переподключиться.'); return }
    const nextId = crypto.randomUUID()
    void window.sheller.sessions.disconnect(sessionId)
    setSessions(prev => prev.map(s => (s.id === sessionId ? { id: nextId, profile: latest, status: 'connecting', tunnels: latest.tunnels.map(t => ({ ...t, status: 'stopped' })) } : s)))
    setActiveSessionId(nextId)
  }, [sessions, profiles, addToast, splitSessions])

  const handleSave = useCallback(async (id: string | null, draft: ProfileDraft): Promise<ProfileActionResult> => {
    const result = await window.sheller.profiles.save(id, draft)
    if (result.ok && result.profile) {
      const saved = result.profile
      setProfiles((previous) => id ? previous.map((profile) => (profile.id === id ? saved : profile)) : [...previous, saved])
      setSessions((previous) => previous.map((session) => session.profile.id === saved.id ? { ...session, profile: saved } : session))
      setEditor(null)
      addToast('success', id ? 'Подключение обновлено' : 'Подключение создано', saved.name)
    }
    return result
  }, [addToast])

  const requestDelete = useCallback((profile: ConnectionProfile): void => { setDeleteTarget(profile) }, [])

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const result = await window.sheller.profiles.remove(deleteTarget.id)
      if (!result.ok) { addToast('error', 'Не удалось удалить подключение', result.error); return }
      await loadProfiles()
      if (editor?.profile?.id === deleteTarget.id) setEditor(null)
      addToast('success', 'Подключение удалено', deleteTarget.name)
      setDeleteTarget(null)
    } finally { setDeleting(false) }
  }, [deleteTarget, editor, addToast, loadProfiles])

  const duplicateProfile = useCallback(async (profile: ConnectionProfile): Promise<void> => {
    try {
      const result = await window.sheller.profiles.duplicate(profile.id)
      if (result.ok && result.profile) {
        setProfiles((previous) => [...previous, result.profile as ConnectionProfile])
        setEditor({ profile: result.profile })
        addToast('success', 'Создана копия', result.profile.name)
      } else if (!result.ok) addToast('error', 'Ошибка', result.error)
    } catch (error) { addToast('error', 'Ошибка', errorMessage(error)) }
  }, [addToast])

  const openEditor = useCallback((profile: ConnectionProfile | null): void => { setEditor({ profile }) }, [])

  const editSessionProfile = useCallback((profile: ConnectionProfile): void => {
    const latest = profiles.find((item) => item.id === profile.id)
    if (!latest) { addToast('error', 'Профиль удалён', 'Создайте новое подключение.'); return }
    setEditor({ profile: latest })
  }, [profiles, addToast])

  const startTunnel = useCallback(async (tunnelId: string): Promise<void> => {
    if (!activeSession) return
    const result = await window.sheller.sessions.startTunnel(activeSession.id, tunnelId)
    if (!result.ok) addToast('error', 'Ошибка туннеля', result.error)
  }, [activeSession, addToast])

  const stopTunnel = useCallback(async (tunnelId: string): Promise<void> => {
    if (!activeSession) return
    const result = await window.sheller.sessions.stopTunnel(activeSession.id, tunnelId)
    if (!result.ok) addToast('error', 'Ошибка туннеля', result.error)
  }, [activeSession, addToast])

  const startUpload = useCallback(async (type: 'file' | 'directory') => {
    if (!activeSession) return
    const paths = await window.sheller.files.pickUpload(type)
    for (const localPath of paths) void window.sheller.files.upload(activeSession.id, localPath, './', crypto.randomUUID())
  }, [activeSession])

  const uploadDroppedFiles = useCallback(async (sessionId: string, localPaths: string[]) => {
    for (const localPath of localPaths) void window.sheller.files.upload(sessionId, localPath, './', crypto.randomUUID())
  }, [])

  const handleExport = useCallback(async () => {
    const res = await window.sheller.profiles.export()
    if (res.ok) addToast('success', 'Профили экспортированы')
    else if (res.error !== 'Отменено') addToast('error', 'Ошибка экспорта', res.error)
  }, [addToast])

  const handleImport = useCallback(async () => {
    const res = await window.sheller.profiles.import()
    if (res.ok) { addToast('success', 'Профили импортированы'); await loadProfiles() } 
    else if (res.error !== 'Отменено') addToast('error', 'Ошибка импорта', res.error)
  }, [addToast, loadProfiles])

  const pasteCommandToActive = useCallback((cmd: string) => {
    if (!activeSession) return
    window.sheller.sessions.write(activeSession.id, cmd)
  }, [activeSession])

  const activeTunnelCount = activeSession ? runningTunnels(activeSession.tunnels) : 0

  return (
    <div className="app-shell">
      <Titlebar sessionCount={sessions.length} />
      <div className="app-body">
        <Sidebar profiles={profiles} sessions={sessions} loading={loading} onConnect={openSession} onNew={() => openEditor(null)} onEdit={(profile) => setEditor({ profile })} onExport={handleExport} onImport={handleImport} />
        <main className="main-area">
          {sessions.length > 0 && <TabBar sessions={sessions} activeId={activeSessionId} onActivate={setActiveSessionId} onClose={closeSession} onNew={() => openEditor(null)} onDetach={handleDetach} onMerge={handleMerge} />}
          <div className="workspace">
            {sessions.length === 0 && <Welcome profiles={profiles} sessions={sessions} onConnect={openSession} onNew={() => openEditor(null)} />}
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              const secondary = splitSessions[session.id]
              return (
                <div key={session.id} className={`session-wrapper ${isActive ? 'is-active' : ''}`}>
                  {secondary ? (
                    <div className="split-container vertical">
                      <TerminalPane session={session} active={isActive} autoFocus={true} onReconnect={() => reconnectSession(session.id)} onClose={() => closeSession(session.id)} onFilesDropped={(paths) => uploadDroppedFiles(session.id, paths)} onSplit={closeSplit} />
                      <TerminalPane session={secondary.session} active={isActive} autoFocus={false} onReconnect={() => reconnectSession(secondary.session.id)} onClose={closeSplit} onFilesDropped={(paths) => uploadDroppedFiles(secondary.session.id, paths)} onSplit={closeSplit} />
                    </div>
                  ) : (
                    <TerminalPane session={session} active={isActive} onReconnect={() => reconnectSession(session.id)} onClose={() => closeSession(session.id)} onFilesDropped={(paths) => uploadDroppedFiles(session.id, paths)} onSplit={isActive ? handleSplit : undefined} onOpenSnippets={isActive ? () => setSnippetsPanelOpen(true) : undefined} onOpenCron={isActive ? () => setCronModalOpen(true) : undefined} />
                  )}
                </div>
              )
            })}
            {activeSession && tunnelPanelOpen && <TunnelPanel session={activeSession} onClose={() => setTunnelPanelOpen(false)} onEditProfile={() => editSessionProfile(activeSession.profile)} onStartTunnel={startTunnel} onStopTunnel={stopTunnel} />}
            {activeSession && sftpPanelOpen && <SFTPPanel session={activeSession} onClose={() => setSftpPanelOpen(false)} />}
            {snippetsPanelOpen && (
              <SnippetsPanel 
                onClose={() => setSnippetsPanelOpen(false)} 
                onPaste={pasteCommandToActive}
              />
            )}
            {activeSession && systemMonitorOpen && (
              <SystemMonitor 
                sessionId={activeSession.id} 
                onClose={() => setSystemMonitorOpen(false)} 
              />
            )}
          </div>
          {activeSession && <SessionStatusBar 
          session={activeSession} 
          tunnelPanelOpen={tunnelPanelOpen} 
          runningTunnelCount={activeTunnelCount} 
          onToggleTunnels={() => setTunnelPanelOpen((open) => !open)} 
          onEdit={() => editSessionProfile(activeSession.profile)} 
          onUpload={startUpload} 
          onDownload={() => setDownloadDialogSession(activeSession)} 
          onToggleSftp={() => setSftpPanelOpen(open => !open)} 
          onToggleMonitor={() => setSystemMonitorOpen(!systemMonitorOpen)}
          monitorOpen={systemMonitorOpen}
          />}
        </main>
      </div>

      {editor && <ConnectionModal key={editor.profile?.id ?? 'new'} profile={editor.profile} profiles={profiles} onClose={() => setEditor(null)} onSave={handleSave} onDelete={requestDelete} onDuplicate={(profile) => void duplicateProfile(profile)} />}
      {deleteTarget && <ConfirmDialog title="Удалить подключение?" description={`«${deleteTarget.name}» будет удалён.`} confirmLabel="Удалить" busy={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />}
      {downloadDialogSession && <FileTransferDialog session={downloadDialogSession} onClose={() => setDownloadDialogSession(null)} />}
      {pwdPrompt && <PasswordPrompt onConfirm={(pwd) => { window.sheller.sessions.providePassword(pwdPrompt.sessionId, pwd); setPwdPrompt(null) }} onCancel={() => { window.sheller.sessions.disconnect(pwdPrompt.sessionId); setPwdPrompt(null) }} />}
      {hostKeyPrompt && <ConfirmDialog title="Неизвестный сервер" description={`Отпечаток ключа: ${hostKeyPrompt.hostKey}. Вы доверяете этому серверу?`} confirmLabel="Доверять" onConfirm={() => { window.sheller.sessions.provideHostKey(hostKeyPrompt.sessionId, true); setHostKeyPrompt(null) }} onCancel={() => { window.sheller.sessions.provideHostKey(hostKeyPrompt.sessionId, false); setHostKeyPrompt(null) }} />}
      {cronModalOpen && activeSession && (
        <CronModal 
          sessionId={activeSession.id} 
          onClose={() => setCronModalOpen(false)} 
        />
      )}

      <div className="bottom-area">
        <TransferList transfers={transfers} onDismiss={dismissTransfer} />
        <Toasts toasts={toasts} onDismiss={dismissToast} />
        <UpdateBanner />
      </div>
      {loading && profiles.length === 0 && <div className="app-loading" aria-hidden="true"><Loader2 size={18} className="spin" /></div>}
    </div>
  )
}

function SessionStatusBar({ 
  session, 
  tunnelPanelOpen, 
  runningTunnelCount, 
  onToggleTunnels, 
  onEdit, 
  onUpload, 
  onDownload, 
  onToggleSftp,
  onToggleMonitor,
  monitorOpen 
}: any): JSX.Element {
  const tunnelTotal = session.tunnels.length
  return (
    <footer className={`session-statusbar status-${session.status}`}>
      <div className="statusbar-left">
        <span className={`status-indicator status-indicator-${session.status}`} />
        <span className="statusbar-state">{statusLabel(session.status)}</span>
        <span className="statusbar-divider" />
        <span className="statusbar-host">{profileSubtitle(session.profile)}</span>
        {session.profile.protocol === 'telnet' && <span className="statusbar-chip">TELNET</span>}
      </div>
      <div className="statusbar-right">
        <span className="statusbar-hint">Ctrl+Shift+V — вставка</span>
        {session.profile.protocol === 'ssh' && (
          <>
            <button type="button" className="statusbar-button" onClick={onToggleSftp} disabled={session.status !== 'connected'} title="SFTP Панель"><FolderUp size={14} />SFTP</button>
            <button type="button" className="statusbar-button" onClick={() => onUpload('file')} disabled={session.status !== 'connected'} title="Загрузить файлы"><ArrowUpFromLine size={14} />Файлы</button>
            <button type="button" className="statusbar-button" onClick={onDownload} disabled={session.status !== 'connected'} title="Скачать"><ArrowDownToLine size={14} />Скачать</button>
            <button type="button" className={`statusbar-button ${tunnelPanelOpen ? 'is-active' : ''}`} onClick={onToggleTunnels} title="Туннели"><Waypoints size={14} />Туннели<span className="statusbar-badge">{runningTunnelCount}/{tunnelTotal}</span></button>
          </>
        )}
        
        <button 
          type="button" 
          className={`statusbar-button ${monitorOpen ? 'is-active' : ''}`} 
          onClick={onToggleMonitor}
          disabled={session.status !== 'connected' || session.profile.protocol === 'telnet'}
          title="Мониторинг системы"
        >
          <Activity size={14} />
          Нагрузка
        </button>
        <button type="button" className="statusbar-button statusbar-icon-button" onClick={onEdit} title="Настройки"><Settings2 size={14} /></button>
      </div>
    </footer>
  )
}