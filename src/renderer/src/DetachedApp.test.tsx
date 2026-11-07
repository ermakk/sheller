// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DetachedApp from './DetachedApp'
import { createProfile, createShellerApi, installShellerApi } from '../../test/api'

const ui = vi.hoisted(() => ({
  terminal: null as any,
  password: null as any,
  confirm: null as any
}))

vi.mock('./components/TerminalPane', () => ({
  TerminalPane: (props: any) => {
    ui.terminal = props
    return (
      <div data-testid="detached-terminal">
        <span>{props.session.status}</span>
        <span>{props.session.message ?? ''}</span>
        <button type="button" onClick={props.onReconnect}>terminal-reconnect</button>
        <button type="button" onClick={props.onClose}>terminal-close</button>
        <button type="button" onClick={() => props.onFilesDropped(['C:\\a.txt'])}>terminal-drop</button>
      </div>
    )
  }
}))

vi.mock('./components/PasswordPrompt', () => ({
  PasswordPrompt: (props: any) => {
    ui.password = props
    return (
      <div role="dialog">
        <button type="button" onClick={() => props.onConfirm('secret')}>password-confirm</button>
        <button type="button" onClick={props.onCancel}>password-cancel</button>
      </div>
    )
  }
}))

vi.mock('./components/ConfirmDialog', () => ({
  ConfirmDialog: (props: any) => {
    ui.confirm = props
    return (
      <div role="alertdialog">
        <span>{props.title}</span>
        <span>{props.description}</span>
        <button type="button" onClick={props.onConfirm}>confirm-dialog-confirm</button>
        <button type="button" onClick={props.onCancel}>confirm-dialog-cancel</button>
      </div>
    )
  }
}))

describe('DetachedApp', () => {
  let api: ReturnType<typeof createShellerApi>
  const listeners: Record<string, (event: any) => void> = {}
  let unsubscribers: ReturnType<typeof vi.fn>[]

  function capture(name: string): void {
    ;(api.events as any)[name] = vi.fn((listener: (event: any) => void) => {
      listeners[name] = listener
      const unsubscribe = vi.fn()
      unsubscribers.push(unsubscribe)
      return unsubscribe
    })
  }

  beforeEach(() => {
    ui.terminal = null
    ui.password = null
    ui.confirm = null
    unsubscribers = []
    for (const key of Object.keys(listeners)) delete listeners[key]

    api = createShellerApi()
    api.profiles.list = vi.fn(async () => [createProfile({ name: 'Prod' })])
    for (const name of ['onStatus', 'onRequestPassword', 'onHostKeyVerify']) capture(name)
    installShellerApi(api)

    Object.defineProperty(window, 'close', {
      value: vi.fn(),
      configurable: true,
      writable: true
    })
  })

  it('загружает профиль, подключает терминал и открепляет сессию', async () => {
    render(<DetachedApp sessionId="session-1" profileId="profile-1" />)

    expect(await screen.findByText('Prod')).toBeInTheDocument()
    expect(screen.getByText('root@example.com')).toBeInTheDocument()
    expect(ui.terminal.session).toMatchObject({
      id: 'session-1',
      status: 'connected',
      profile: { id: 'profile-1' }
    })

    fireEvent.click(screen.getByTitle('Вернуть в главное окно'))
    expect(api.sessions.attach).toHaveBeenCalledWith('session-1', 'profile-1')

    fireEvent.click(screen.getByRole('button', { name: 'terminal-drop' }))
    expect(api.files.upload).toHaveBeenCalledWith(
      'session-1',
      'C:\\a.txt',
      './',
      expect.any(String)
    )

    fireEvent.click(screen.getByRole('button', { name: 'terminal-reconnect' }))
    expect(ui.terminal.session.status).toBe('connecting')

    fireEvent.click(screen.getByRole('button', { name: 'terminal-close' }))
    expect(api.sessions.disconnect).toHaveBeenCalledWith('session-1')
    expect(window.close).toHaveBeenCalledTimes(1)
  })

  it('реагирует только на события своей сессии и отписывается', async () => {
    const { unmount } = render(<DetachedApp sessionId="session-1" profileId="profile-1" />)
    await screen.findByText('Prod')

    act(() => listeners.onStatus({ sessionId: 'other', status: 'error', message: 'чужое' }))
    expect(ui.terminal.session.status).toBe('connected')
    expect(ui.terminal.session.message).toBeUndefined()

    act(() => listeners.onStatus({ sessionId: 'session-1', status: 'error', message: 'сбой' }))
    expect(ui.terminal.session.status).toBe('error')
    expect(ui.terminal.session.message).toBe('сбой')

    unmount()
    expect(unsubscribers).toHaveLength(3)
    for (const unsubscribe of unsubscribers) expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('запрашивает пароль и обрабатывает отмену', async () => {
    render(<DetachedApp sessionId="session-1" profileId="profile-1" />)
    await screen.findByText('Prod')

    act(() => listeners.onRequestPassword({ sessionId: 'other' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => listeners.onRequestPassword({ sessionId: 'session-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'password-confirm' }))
    expect(api.sessions.providePassword).toHaveBeenCalledWith('session-1', 'secret')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => listeners.onRequestPassword({ sessionId: 'session-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'password-cancel' }))
    expect(api.sessions.disconnect).toHaveBeenCalledWith('session-1')
  })

  it('подтверждает ключ сервера и предупреждает о его смене', async () => {
    render(<DetachedApp sessionId="session-1" profileId="profile-1" />)
    await screen.findByText('Prod')

    act(() => listeners.onHostKeyVerify({ sessionId: 'other', hostKey: 'SHA256:other' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    act(() =>
      listeners.onHostKeyVerify({
        sessionId: 'session-1',
        hostKey: 'SHA256:new',
        previousHostKey: 'SHA256:old'
      })
    )
    expect(screen.getByText('Ключ сервера изменился!')).toBeInTheDocument()
    expect(ui.confirm.description).toContain('SHA256:new')
    fireEvent.click(screen.getByRole('button', { name: 'confirm-dialog-confirm' }))
    expect(api.sessions.provideHostKey).toHaveBeenCalledWith('session-1', true)

    act(() => listeners.onHostKeyVerify({ sessionId: 'session-1', hostKey: 'SHA256:new' }))
    expect(screen.getByText('Неизвестный сервер')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'confirm-dialog-cancel' }))
    expect(api.sessions.provideHostKey).toHaveBeenCalledWith('session-1', false)
  })

  it('ничего не рендерит без профиля', async () => {
    api.profiles.list = vi.fn(async () => [])
    const { container } = render(<DetachedApp sessionId="session-1" profileId="missing" />)
    await waitFor(() => expect(api.profiles.list).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
