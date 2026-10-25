import { useEffect, useState } from 'react'
import { Activity, HardDrive, Thermometer, MemoryStick, X } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { SystemStats } from '@shared/types'

interface SystemMonitorProps {
  sessionId: string
  onClose: () => void
}

function StatsCard({ icon, label, value, unit, color }: any) {
  return (
    <div className="stats-card">
      <div className="stats-card-icon" style={{ color }}>{icon}</div>
      <div className="stats-card-content">
        <span className="stats-card-label">{label}</span>
        <span className="stats-card-value">{value}<small>{unit}</small></span>
      </div>
    </div>
  )
}

export function SystemMonitor({ sessionId, onClose }: SystemMonitorProps): JSX.Element {
  const [history, setHistory] = useState<SystemStats[]>([])
  const [current, setCurrent] = useState<SystemStats | null>(null)

  useEffect(() => {
    // Запускаем опрос на бэкенде
    window.sheller.sessions.startStatsPolling(sessionId)

    const unsub = window.sheller.events.onStats((event) => {
      if (event.sessionId !== sessionId) return
      
      setCurrent(event.stats)
      setHistory((prev) => {
        const next = [...prev, event.stats]
        if (next.length > 30) next.shift() // Храним последние 30 точек (минута)
        return next
      })
    })

    return () => {
      unsub()
      window.sheller.sessions.stopStatsPolling(sessionId)
    }
  }, [sessionId])

  return (
    <div className="system-monitor">
      <header className="sftp-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={16} color="var(--accent)" />
          <span>Мониторинг системы</span>
        </div>
        <button className="modal-icon-button" onClick={onClose}><X size={16} /></button>
      </header>

      <div className="system-monitor-body">
        {!current ? (
          <div className="file-browser-empty">Ожидание данных...</div>
        ) : (
          <>
            <div className="stats-grid">
              <StatsCard icon={<Activity size={18} />} label="CPU" value={current.cpu.toFixed(1)} unit="%" color="var(--accent)" />
              <StatsCard icon={<MemoryStick size={18} />} label="RAM" value={current.ram.toFixed(1)} unit="%" color="var(--purple)" />
              <StatsCard icon={<HardDrive size={18} />} label="Диск" value={current.disk.toFixed(0)} unit="%" color="var(--accent-blue)" />
              <StatsCard icon={<Thermometer size={18} />} label="Темп" value={current.temp > 0 ? current.temp.toFixed(1) : 'N/A'} unit={current.temp > 0 ? "°C" : ""} color="var(--warning)" />
            </div>

            <div className="chart-container">
              <span className="section-kicker" style={{ marginBottom: 10, display: 'block' }}>График нагрузки</span>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--purple)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="var(--purple)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="timestamp" hide />
                    <YAxis domain={[0, 100]} tick={{ fill: 'var(--faint)', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                      labelFormatter={() => ''}
                      formatter={(value: any, name: any) => [`${Number(value).toFixed(1)}%`, name === 'cpu' ? 'CPU' : 'RAM']}
                    />
                    <Area type="monotone" dataKey="cpu" stroke="var(--accent)" strokeWidth={2} fillOpacity={1} fill="url(#colorCpu)" isAnimationActive={false} />
                    <Area type="monotone" dataKey="ram" stroke="var(--purple)" strokeWidth={2} fillOpacity={1} fill="url(#colorRam)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 10, marginTop: 10 }}>
                <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} /> CPU</span>
                <span style={{ color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--purple)' }} /> RAM</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}