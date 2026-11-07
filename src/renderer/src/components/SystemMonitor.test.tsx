// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemMonitor } from './SystemMonitor'
import { createShellerApi, installShellerApi } from '../../../test/api'
import type { SystemStats } from '@shared/types'

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null
}))

describe('SystemMonitor', () => {
  let statsListener: ((event: { sessionId: string; stats: SystemStats }) => void) | undefined
  let api: ReturnType<typeof createShellerApi>

  beforeEach(() => {
    statsListener = undefined
    api = createShellerApi()
    api.events.onStats = vi.fn((listener) => {
      statsListener = listener
      return vi.fn()
    })
    installShellerApi(api)
  })

  it('запускает и останавливает опрос, показывает ожидание', () => {
    const onClose = vi.fn()
    const { unmount } = render(<SystemMonitor sessionId="session-1" onClose={onClose} />)

    expect(screen.getByText('Мониторинг системы')).toBeInTheDocument()
    expect(screen.getByText('Ожидание данных...')).toBeInTheDocument()
    expect(api.sessions.startStatsPolling).toHaveBeenCalledWith('session-1')

    fireEvent.click(screen.getByRole('button'))
    expect(onClose).toHaveBeenCalledTimes(1)

    unmount()
    expect(api.sessions.stopStatsPolling).toHaveBeenCalledWith('session-1')
  })

  it('отображает метрики после события и игнорирует чужие сессии', () => {
    render(<SystemMonitor sessionId="session-1" onClose={vi.fn()} />)

    act(() => {
      statsListener?.({ sessionId: 'other', stats: { cpu: 1, ram: 1, disk: 1, temp: 0, timestamp: 1 } })
    })
    expect(screen.getByText('Ожидание данных...')).toBeInTheDocument()

    act(() => {
      statsListener?.({ sessionId: 'session-1', stats: { cpu: 12.34, ram: 42.2, disk: 77.6, temp: 45.5, timestamp: 1 } })
    })

    expect(screen.getByText('12.3')).toBeInTheDocument()
    expect(screen.getByText('42.2')).toBeInTheDocument()
    expect(screen.getByText('78')).toBeInTheDocument()
    expect(screen.getByText('45.5')).toBeInTheDocument()
    expect(screen.getByText('°C')).toBeInTheDocument()
  })

  it('показывает N/A без датчика температуры', () => {
    render(<SystemMonitor sessionId="session-1" onClose={vi.fn()} />)

    act(() => {
      statsListener?.({ sessionId: 'session-1', stats: { cpu: 0, ram: 0, disk: 0, temp: 0, timestamp: 1 } })
    })

    expect(screen.getByText('N/A')).toBeInTheDocument()
  })
})
