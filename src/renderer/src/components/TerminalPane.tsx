import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import {
  ClipboardPaste, Copy, Loader2, RefreshCw, SplitSquareHorizontal,
  Unplug, X, Terminal as TerminalIcon, CalendarClock, Maximize2, Minimize2
} from 'lucide-react'
import type { SessionTab } from '../types'
import { errorMessage } from '../utils'

interface TerminalPaneProps {
  session: SessionTab
  active: boolean
  autoFocus?: boolean
  autoConnect?: boolean
  onReconnect: () => void
  onClose: () => void
  onFilesDropped: (localPaths: string[]) => void
  onSplit?: () => void
  onOpenSnippets?: () => void
  onOpenCron?: () => void
}

export function TerminalPane({
  session, active, autoFocus = true, autoConnect = true,
  onReconnect, onClose, onFilesDropped, onSplit, onOpenSnippets, onOpenCron
}: TerminalPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  const [hasSelection, setHasSelection] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    return window.sheller.window.onFullscreenChange((fs) => {
      setIsFullscreen(fs)
    })
  }, [])

  useEffect(() => {
    return () => {
      window.sheller.window.setFullscreen(false)
    }
  }, [])

  const toggleFullscreen = (value: boolean) => {
    setIsFullscreen(value)
    window.sheller.window.setFullscreen(value)
  }

  const copySelection = useCallback((clear = true): boolean => {
    const terminal = terminalRef.current
    if (!terminal) return false
    const selection = terminal.getSelection()
    if (!selection) return false
    window.sheller.clipboard.writeText(selection)
    if (clear) { terminal.clearSelection(); setHasSelection(false) }
    return true
  }, [])

  const pasteClipboard = useCallback((): void => {
    const terminal = terminalRef.current
    if (!terminal) return
    const text = window.sheller.clipboard.readText()
    if (!text) return
    terminal.focus()
    terminal.paste(text)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      try { fitRef.current?.fit() } catch { undefined }
      if (autoFocus) terminalRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [isFullscreen, autoFocus])

  useEffect(() => {
    activeRef.current = active
    if (!active) return
    const frame = window.requestAnimationFrame(() => {
      try { fitRef.current?.fit() } catch { undefined }
      if (autoFocus) terminalRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, autoFocus])

  useEffect(() => {
    if (session.status === 'connected') {
      setLocalError(null)
      if (activeRef.current && autoFocus) terminalRef.current?.focus()
    }
  }, [session.status, autoFocus])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let resizeFrame = 0

    const terminal = new Terminal({
      cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2,
      fontFamily: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", "SF Mono", Consolas, monospace',
      fontSize: 13.5, lineHeight: 1.24, letterSpacing: 0, scrollback: 30000,
      drawBoldTextInBrightColors: true, allowTransparency: true,
      theme: {
        background: '#090d14', foreground: '#d8e2f0', cursor: '#5eead4', cursorAccent: '#090d14',
        selectionBackground: 'rgba(94, 234, 212, 0.24)', selectionInactiveBackground: 'rgba(94, 234, 212, 0.13)',
        black: '#18202d', red: '#f87171', green: '#4ade80', yellow: '#fbbf24', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d6deeb',
        brightBlack: '#5b6a82', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f4f8ff'
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon((_event, uri) => { window.open(uri, '_blank', 'noopener,noreferrer') }))
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fitAddon
    try { fitAddon.fit() } catch { undefined }

    const fit = (): void => {
      if (!activeRef.current) return
      const element = hostRef.current
      if (!element || element.clientWidth < 40 || element.clientHeight < 20) return
      try { fitAddon.fit() } catch { undefined }
    }

    const dataSubscription = window.sheller.events.onData((event) => { if (event.sessionId === session.id) terminal.write(event.data) })
    const selectionSubscription = terminal.onSelectionChange(() => { setHasSelection(terminal.hasSelection()) })
    const inputSubscription = terminal.onData((data) => { window.sheller.sessions.write(session.id, data) })
    const resizeSubscription = terminal.onResize(({ cols, rows }) => { window.sheller.sessions.resize(session.id, cols, rows) })

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const key = event.key.toLowerCase()
      const copyShortcut = ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'c') || (event.metaKey && !event.shiftKey && key === 'c') || (event.ctrlKey && key === 'insert') || (event.ctrlKey && !event.shiftKey && !event.altKey && key === 'c' && terminal.hasSelection())
      if (copyShortcut) { event.preventDefault(); copySelection(true); return false }
      const pasteShortcut = ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'v') || (event.shiftKey && key === 'insert')
      if (pasteShortcut) { event.preventDefault(); pasteClipboard(); return false }
      return true
    })

    const resizeObserver = new ResizeObserver(() => { window.cancelAnimationFrame(resizeFrame); resizeFrame = window.requestAnimationFrame(fit) })
    resizeObserver.observe(host)
    void document.fonts.ready.then(fit)

    const connect = async (): Promise<void> => {
      if (!autoConnect) return
      const result = await window.sheller.sessions.connect({ sessionId: session.id, profileId: session.profile.id, cols: terminal.cols, rows: terminal.rows })
      if (cancelled) return
      if (!result.ok) setLocalError(result.error ?? 'Не удалось подключиться')
    }
    void connect().catch((error) => { if (!cancelled) setLocalError(errorMessage(error)) })

    if (activeRef.current && autoFocus) { window.requestAnimationFrame(() => terminal.focus()) }

    return () => {
      cancelled = true
      window.cancelAnimationFrame(resizeFrame)
      resizeObserver.disconnect()
      dataSubscription(); selectionSubscription.dispose(); inputSubscription.dispose(); resizeSubscription.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [session.id, session.profile.id, copySelection, pasteClipboard, autoConnect, autoFocus])

  const dropHandler = (event: React.DragEvent<HTMLElement>): void => {
    if (session.status !== 'connected' || session.profile.protocol === 'telnet') return
    event.preventDefault(); event.stopPropagation(); setDragOver(false)
    const files = Array.from(event.dataTransfer.files)
    const paths: string[] = []
    for (const file of files) {
      try { const path = window.sheller.files.getPathForFile(file); if (path) paths.push(path) } catch { undefined }
    }
    if (paths.length > 0) onFilesDropped(paths)
  }

  const failed = session.status === 'error' || session.status === 'disconnected' || Boolean(localError)
  const message = localError ?? session.message ?? (session.status === 'disconnected' ? 'Соединение закрыто' : 'Не удалось подключиться')
  const connecting = session.status === 'connecting' && !localError

  const renderTools = () => (
    <>
      {onOpenSnippets && <button type="button" className="terminal-tool" onClick={onOpenSnippets} title="Сниппеты"><TerminalIcon size={14} /></button>}
      {onOpenCron && <button type="button" className="terminal-tool" onClick={onOpenCron} title="Cron планировщик"><CalendarClock size={14} /></button>}
      {onSplit && <button type="button" className="terminal-tool" onClick={onSplit} title="Разделить экран"><SplitSquareHorizontal size={14} /></button>}
      <button type="button" className="terminal-tool" disabled={!hasSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => copySelection(true)} title="Копировать"><Copy size={14} /></button>
      <button type="button" className="terminal-tool" disabled={session.status !== 'connected'} onMouseDown={(event) => event.preventDefault()} onClick={pasteClipboard} title="Вставить"><ClipboardPaste size={14} /></button>
    </>
  )

  return (
    <section
      className={`terminal-pane ${active ? 'is-active' : ''} ${dragOver ? 'is-drop-target' : ''} ${isFullscreen ? 'is-fullscreen' : ''}`}
      aria-hidden={!active}
      aria-label={`Терминал ${session.profile.name}`}
      onDragOver={(event) => {
        if (session.status !== 'connected' || session.profile.protocol === 'telnet') return
        if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true) }
      }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragOver(false) }}
      onDrop={dropHandler}
    >
      <div ref={hostRef} className="terminal-host" />

      {dragOver && (
        <div className="terminal-drop-overlay">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Отпустите для загрузки на сервер</span>
        </div>
      )}

      {!connecting && (
        <div className={`terminal-tools ${isFullscreen ? 'is-floating-fullscreen' : ''}`}>
          {isFullscreen && (
            <div className="terminal-floating-title">
              <span>{session.profile.name}</span>
              <span className="terminal-floating-host">{session.profile.username}@{session.profile.host}</span>
            </div>
          )}
          {renderTools()}
          <button type="button" className="terminal-tool" onClick={() => toggleFullscreen(!isFullscreen)} title={isFullscreen ? "Выйти из полноэкранного режима" : "На весь экран"}>
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      )}

      {connecting && (
        <div className="terminal-connecting">
          <span className="terminal-connecting-glow" /><span className="terminal-spinner"><Loader2 size={26} className="spin" /></span>
          <strong>Устанавливаем соединение</strong>
          <span className="terminal-connecting-host">{session.profile.username}@{session.profile.host}:{session.profile.port}</span>
          <button type="button" className="button button-ghost button-small" onClick={onClose}>Отмена</button>
        </div>
      )}
      {failed && !connecting && (
        <div className="terminal-notice" role="status">
          <span className="terminal-notice-icon"><Unplug size={17} /></span>
          <div className="terminal-notice-copy"><strong>{session.status === 'disconnected' ? 'Сессия завершена' : 'Соединение прервано'}</strong><span>{message}</span></div>
          <div className="terminal-notice-actions">
            <button type="button" className="button button-secondary button-small" onClick={onReconnect}><RefreshCw size={13} />Переподключиться</button>
            <button type="button" className="button button-ghost button-small" onClick={onClose}><X size={13} />Закрыть</button>
          </div>
        </div>
      )}
    </section>
  )
}