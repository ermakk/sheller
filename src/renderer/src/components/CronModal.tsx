import { useEffect, useState } from 'react'
import { CalendarClock, Play, Trash2, Plus, Loader2, RefreshCw, X, AlertCircle } from 'lucide-react'
import type { CronJob } from '@shared/types'

interface CronModalProps {
  sessionId: string
  onClose: () => void
}

const PRESETS = [
  { label: 'Каждую минуту', val: '* * * * *' },
  { label: 'Каждый час', val: '0 * * * *' },
  { label: 'Каждый день в полночь', val: '0 0 * * *' },
  { label: 'Каждый понедельник', val: '0 0 * * 1' },
  { label: 'Каждое 1-е число', val: '0 0 1 * *' },
]

export function CronModal({ sessionId, onClose }: CronModalProps): JSX.Element {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Форма добавления новой задачи
  const [min, setMin] = useState('*')
  const [hour, setHour] = useState('*')
  const [day, setDay] = useState('*')
  const [month, setMonth] = useState('*')
  const [weekday, setWeekday] = useState('*')
  const [command, setCommand] = useState('')

  const schedule = `${min} ${hour} ${day} ${month} ${weekday}`

  const loadJobs = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.sheller.sessions.cronList(sessionId)
      setJobs(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить crontab')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadJobs() }, [sessionId])

  const saveJobs = async (newJobs: CronJob[]) => {
    setSaving(true)
    setError(null)
    try {
      const res = await window.sheller.sessions.cronSave(sessionId, newJobs)
      if (res.ok) {
        setJobs(newJobs)
      } else {
        setError(res.error ?? 'Не удалось сохранить crontab')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = () => {
    if (!command.trim()) return
    const newJob: CronJob = { id: crypto.randomUUID(), schedule, command: command.trim() }
    void saveJobs([...jobs, newJob])
    setCommand('')
  }

  const handleRemove = (id: string) => {
    void saveJobs(jobs.filter(j => j.id !== id))
  }

  const applyPreset = (val: string) => {
    const parts = val.split(' ')
    setMin(parts[0]); setHour(parts[1]); setDay(parts[2]); setMonth(parts[3]); setWeekday(parts[4])
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="file-transfer-dialog" style={{ width: 700 }} role="dialog" onMouseDown={e => e.stopPropagation()}>
        <header className="file-transfer-header">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <CalendarClock size={24} color="var(--accent)" />
            <div>
              <h2>Планировщик задач (Cron)</h2>
              <p>Управление задачами crontab на сервере</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="modal-icon-button" onClick={loadJobs} disabled={loading || saving} title="Обновить">
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </button>
            <button className="modal-icon-button" onClick={onClose}><X size={18} /></button>
          </div>
        </header>

        <div className="file-transfer-form" style={{ flexDirection: 'row', gap: 16, maxHeight: '60vh', overflowY: 'auto' }}>
          {/* Левая колонка: Список текущих задач */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="section-kicker">Текущие задачи</span>
            {jobs.length === 0 && !loading && (
              <div className="file-browser-empty" style={{ padding: 20 }}>Нет активных задач</div>
            )}
            {jobs.map(job => (
              <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>{job.schedule}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-soft)', wordBreak: 'break-all' }}>{job.command}</div>
                </div>
                <button
                  type="button"
                  className="modal-icon-button button-danger-text"
                  onClick={() => handleRemove(job.id)}
                  disabled={saving}
                  title="Удалить задачу"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Правая колонка: Форма добавления */}
          <div style={{ flex: 1, borderLeft: '1px solid var(--border)', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="section-kicker">Добавить задачу</span>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {PRESETS.map(p => (
                <button key={p.label} type="button" className="button button-secondary button-small" onClick={() => applyPreset(p.val)}>
                  {p.label}
                </button>
              ))}
            </div>

            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
              <label className="field"><span className="field-label">Мин</span><input value={min} onChange={e => setMin(e.target.value)} style={{ padding: 4, textAlign: 'center' }} /></label>
              <label className="field"><span className="field-label">Час</span><input value={hour} onChange={e => setHour(e.target.value)} style={{ padding: 4, textAlign: 'center' }} /></label>
              <label className="field"><span className="field-label">День</span><input value={day} onChange={e => setDay(e.target.value)} style={{ padding: 4, textAlign: 'center' }} /></label>
              <label className="field"><span className="field-label">Мес</span><input value={month} onChange={e => setMonth(e.target.value)} style={{ padding: 4, textAlign: 'center' }} /></label>
              <label className="field"><span className="field-label">ДН</span><input value={weekday} onChange={e => setWeekday(e.target.value)} style={{ padding: 4, textAlign: 'center' }} /></label>
            </div>

            <label className="field">
              <span className="field-label">Команда</span>
              <input value={command} onChange={e => setCommand(e.target.value)} placeholder="echo 'hi'" spellCheck={false} />
            </label>

            <div style={{ marginTop: 4, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-soft)' }}>
              {schedule} {command || '...'}
            </div>

            <button className="button button-primary" onClick={handleAdd} disabled={!command.trim() || saving} style={{ marginTop: 8 }}>
              {saving ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
              {saving ? 'Сохранение...' : 'Добавить'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '0 20px 10px' }}>
            <span className="form-error"><AlertCircle size={14} />{error}</span>
          </div>
        )}

        <footer className="file-transfer-footer">
          <button className="button button-ghost" onClick={onClose}>Закрыть</button>
        </footer>
      </div>
    </div>
  )
}