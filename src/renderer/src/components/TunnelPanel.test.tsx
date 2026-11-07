// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TunnelPanel } from './TunnelPanel'
import { createSession, createTunnel } from '../../../test/api'

describe('TunnelPanel', () => {
  it('показывает пустое состояние и открывает настройки профиля', () => {
    const onEditProfile = vi.fn()
    render(
      <TunnelPanel
        session={createSession()}
        onClose={vi.fn()}
        onEditProfile={onEditProfile}
        onStartTunnel={vi.fn()}
        onStopTunnel={vi.fn()}
      />
    )

    expect(screen.getByText('Туннелей пока нет')).toBeInTheDocument()
    expect(
      screen.getByRole('complementary', { name: 'Туннели сессии' }).querySelector('header p')
    ).toHaveTextContent('0 из 0 активны')
    fireEvent.click(screen.getByRole('button', { name: /настроить/i }))
    expect(onEditProfile).toHaveBeenCalledTimes(1)
  })

  it('предупреждает об отсутствии подключения', () => {
    render(
      <TunnelPanel
        session={createSession({ status: 'connecting', tunnels: [createTunnel()] })}
        onClose={vi.fn()}
        onEditProfile={vi.fn()}
        onStartTunnel={vi.fn()}
        onStopTunnel={vi.fn()}
      />
    )

    expect(screen.getByText('Подключитесь к серверу, чтобы управлять туннелями.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /запустить/i })).toBeDisabled()
  })

  it('отрисовывает локальный, удалённый и динамический туннели', () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    render(
      <TunnelPanel
        session={createSession({
          tunnels: [
            createTunnel({ id: 'local', status: 'running', bindPort: 0, boundPort: 9090, autoStart: true }),
            createTunnel({
              id: 'remote',
              type: 'remote',
              name: 'DB',
              status: 'error',
              message: 'Порт занят',
              bindPort: 5432
            }),
            createTunnel({ id: 'dynamic', type: 'dynamic', name: 'Proxy', status: 'starting', bindPort: 1080 })
          ]
        })}
        onClose={vi.fn()}
        onEditProfile={vi.fn()}
        onStartTunnel={onStart}
        onStopTunnel={onStop}
      />
    )

    expect(
      screen.getByRole('complementary', { name: 'Туннели сессии' }).querySelector('header p')
    ).toHaveTextContent('1 из 3 активны')
    expect(screen.getByText('Активен')).toBeInTheDocument()
    expect(screen.getByText('Ошибка')).toBeInTheDocument()
    expect(screen.getAllByText('Запуск')).toHaveLength(2)
    expect(screen.getByText('Выдан порт 9090')).toBeInTheDocument()
    expect(screen.getByText('Порт занят')).toBeInTheDocument()
    expect(screen.getByText('SOCKS5 на этом компьютере')).toBeInTheDocument()
    expect(screen.getByText('На сервере')).toBeInTheDocument()
    expect(screen.getByText('На этом ПК')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /остановить/i }))
    expect(onStop).toHaveBeenCalledWith('local')
    expect(screen.getByRole('button', { name: 'Запуск' })).toBeDisabled()
  })

  it('запускает остановленный туннель и закрывает панель', () => {
    const onStart = vi.fn()
    const onClose = vi.fn()
    render(
      <TunnelPanel
        session={createSession({ tunnels: [createTunnel({ status: 'stopped' })] })}
        onClose={onClose}
        onEditProfile={vi.fn()}
        onStartTunnel={onStart}
        onStopTunnel={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /запустить/i }))
    expect(onStart).toHaveBeenCalledWith('tunnel-1')

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель туннелей' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
