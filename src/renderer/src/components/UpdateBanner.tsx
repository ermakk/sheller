import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, Rocket, X } from 'lucide-react'
import type { UpdateState } from '@shared/types'

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function UpdateBanner(): JSX.Element | null {
  const [state, setState] = useState<UpdateState>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)
  const [transferred, setTransferred] = useState(0)
  const [total, setTotal] = useState(0)
  const [bytesPerSecond, setBytesPerSecond] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const stateRef = useRef<UpdateState>('idle')
  const retryAction = useRef<'check' | 'download'>('check')

  const applyState = useCallback((next: UpdateState): void => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    const offStatus = window.updater.onStatus((event) => {
      applyState(event.state)
      if (event.version) setVersion(event.version)

      if (event.state === 'checking') {
        retryAction.current = 'check'
        setError(null)
        setPercent(0)
        setDismissed(false)
      }
      if (event.state === 'available') {
        retryAction.current = 'download'
        setError(null)
        setPercent(0)
        setDismissed(false)
      }
      if (event.state === 'ready') {
        setError(null)
        setDismissed(false)
      }
    })

    const offProgress = window.updater.onProgress((event) => {
      setPercent(Math.min(100, Math.max(0, event.percent)))
      setTransferred(event.transferred)
      setTotal(event.total)
      setBytesPerSecond(event.bytesPerSecond)
    })

    const offError = window.updater.onError((event) => {
      retryAction.current = stateRef.current === 'downloading' ? 'download' : 'check'
      setError(event.message)
      applyState('error')
      setDismissed(false)
    })

    return () => {
      offStatus()
      offProgress()
      offError()
    }
  }, [applyState])

  const runCheck = useCallback(async (): Promise<void> => {
    setError(null)
    applyState('checking')
    const result = await window.updater.check()
    if (!result.ok) {
      setError(result.error ?? 'Не удалось проверить обновления.')
      applyState('error')
    }
  }, [applyState])

  const runDownload = useCallback(async (): Promise<void> => {
    setError(null)
    applyState('downloading')
    setPercent(0)
    const result = await window.updater.download()
    if (!result.ok) {
      setError(result.error ?? 'Не удалось скачать обновление.')
      applyState('error')
    }
  }, [applyState])

  const handleRetry = useCallback((): void => {
    if (retryAction.current === 'download') void runDownload()
    else void runCheck()
  }, [runCheck, runDownload])

  const handleInstall = useCallback((): void => {
    void window.updater.install()
  }, [])

  if (state === 'idle' || dismissed) return null

  const title = (() => {
    switch (state) {
      case 'checking':
        return 'Проверка обновлений'
      case 'available':
        return version ? `Доступно обновление v${version}` : 'Доступно обновление'
      case 'downloading':
        return version ? `Загрузка обновления v${version}` : 'Загрузка обновления'
      case 'ready':
        return 'Обновление готово'
      case 'error':
        return 'Не удалось обновить приложение'
      default:
        return ''
    }
  })()

  const description = (() => {
    switch (state) {
      case 'checking':
        return 'Связываемся с GitHub Releases…'
      case 'available':
        return 'Новая версия уже опубликована. Скачайте её сейчас.'
      case 'downloading':
        return 'Обновление загружается в фоне, можно продолжать работу.'
      case 'ready':
        return 'Перезапустите Sheller, чтобы применить обновление.'
      case 'error':
        return error ?? 'Неизвестная ошибка.'
      default:
        return ''
    }
  })()

  const icon =
    state === 'ready' ? (
      <CheckCircle2 size={16} />
    ) : state === 'error' ? (
      <AlertTriangle size={16} />
    ) : state === 'checking' ? (
      <Loader2 size={16} className="spin" />
    ) : (
      <Download size={16} />
    )

  return (
    <div className={`update-banner${state === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
      <span className="update-banner-icon">{icon}</span>
      <div className="update-banner-copy">
        <strong>{title}</strong>
        <span>{description}</span>

        {state === 'downloading' && (
          <>
            <div className="update-progress">
              <div className="update-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="update-progress-meta">
              <span>{percent.toFixed(0)}% · {formatBytes(transferred)} из {formatBytes(total)}</span>
              <span>{formatBytes(bytesPerSecond)}/с</span>
            </div>
          </>
        )}

        {state === 'available' && (
          <div className="update-banner-actions">
            <button type="button" className="button button-primary button-small" onClick={() => void runDownload()}>
              <Download size={13} />
              Скачать
            </button>
          </div>
        )}

        {state === 'ready' && (
          <div className="update-banner-actions">
            <button type="button" className="button button-primary button-small" onClick={handleInstall}>
              <Rocket size={13} />
              Перезапустить и обновить
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="update-banner-actions">
            <button type="button" className="button button-secondary button-small" onClick={handleRetry}>
              <RefreshCw size={13} />
              Повторить
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="update-banner-close"
        onClick={() => setDismissed(true)}
        aria-label="Скрыть уведомление об обновлении"
      >
        <X size={13} />
      </button>
    </div>
  )
}
