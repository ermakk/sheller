// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Welcome } from './Welcome'
import { createProfile, createSession, createTunnel } from '../../../test/api'

describe('Welcome', () => {
  it('показывает пустое состояние и создаёт подключение', () => {
    const onNew = vi.fn()
    render(<Welcome profiles={[]} sessions={[]} onConnect={vi.fn()} onNew={onNew} />)

    expect(screen.getByText('Добавьте первый сервер')).toBeInTheDocument()
    expect(screen.getAllByText('0', { selector: '.hero-stats strong' })).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Создать подключение' }))
    fireEvent.click(screen.getByRole('button', { name: 'Новое подключение' }))
    expect(onNew).toHaveBeenCalledTimes(2)
  })

  it('сортирует недавние профили и показывает статистику', () => {
    const profiles = [
      createProfile({
        id: 'old',
        name: 'Old',
        host: 'old.example',
        lastUsedAt: '2024-01-01T00:00:00.000Z'
      }),
      createProfile({
        id: 'new',
        name: 'New',
        lastUsedAt: '2024-06-01T00:00:00.000Z',
        tunnels: [createTunnel()],
        jumpProfileId: 'jump'
      })
    ]
    const onConnect = vi.fn()
    render(
      <Welcome
        profiles={profiles}
        sessions={[createSession()]}
        onConnect={onConnect}
        onNew={vi.fn()}
      />
    )

    const rows = screen.getAllByRole('button', { name: /New|Old/ })
    expect(rows[0]).toHaveTextContent('New')
    expect(screen.getAllByText('2', { selector: '.hero-stats strong' })).toHaveLength(1)
    expect(screen.getAllByText('1', { selector: '.hero-stats strong' })).toHaveLength(2)
    expect(screen.getByTitle('Через jump-хост')).toBeInTheDocument()
    expect(screen.getByText('root@example.com')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(onConnect).toHaveBeenCalledWith(profiles[1])

    fireEvent.click(screen.getByText('Old'))
    expect(onConnect).toHaveBeenCalledWith(profiles[0])
  })

  it('показывает не более пяти профилей и остаток', () => {
    const profiles = Array.from({ length: 7 }, (_, index) =>
      createProfile({
        id: `p${index}`,
        name: `Server ${index}`,
        lastUsedAt: `2024-01-0${index + 1}T00:00:00.000Z`
      })
    )
    render(<Welcome profiles={profiles} sessions={[]} onConnect={vi.fn()} onNew={vi.fn()} />)

    expect(screen.getByText('Ещё 2 в боковой панели')).toBeInTheDocument()
    expect(screen.queryByText('Server 0')).not.toBeInTheDocument()
    expect(screen.getAllByText('Server 6')).toHaveLength(2)
  })
})
