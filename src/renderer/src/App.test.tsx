// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createProfile,
  createShellerApi,
  createSnippet,
  createTunnel,
  installShellerApi
} from '../../test/api'

const ui = vi.hoisted(() => ({
  terminals: new Map<string, any>(),
  sidebar: null as any,
  tabbar: null as any,
  connection: null as any,
  tunnelPanel: null as any,
  snippetsPanel: null as any,
  transfers: null as any
}))

vi.mock('./components/Titlebar', () => ({
  Titlebar: ({ sessionCount }: { sessionCount: number }) => (
    <div data-testid="titlebar">sessions:{sessionCount}</div>
  )
}))

vi.mock('./components/Sidebar', () => ({
  Sidebar: (props: any) => {
    ui.sidebar = props
    return (
      <aside>
        <span>loading:{String(props.loading)}</span>
        {props.profiles.map((profile: any) => (
          <span key={profile.id}>{profile.name}</span>
        ))}
        <button type="button" onClick={() => props.onConnect(props.profiles[0])}>connect-first</button>
        <button type="button" onClick={props.onNew}>new-profile</button>
        <button type="button" onClick={() => props.onEdit(props.profiles[0])}>edit-first</button>
        <button type="button" onClick={props.onExport}>export-profiles</button>
        <button type="button" onClick={props.onImport}>import-profiles</button>
      </aside>
    )
  }
}))

vi.mock('./components/TabBar', () => ({
  TabBar: (props: any) => {
    ui.tabbar = props
    return (
      <div>
        <span>tabs:{props.sessions.map((session: any) => session.id).join(',')}</span>
        {props.sessions.map((session: any) => (
          <span key={session.id}>
            <button type="button" aria-label={`activate-${session.id}`} onClick={() => props.onActivate(session.id)}>activate</button>
            <button type="button" aria-label={`close-${session.id}`} onClick={() => props.onClose(session.id)}>close</button>
            <button type="button" aria-label={`detach-${session.id}`} onClick={() => props.onDetach(session.id)}>detach</button>
            <button
              type="button"
              aria-label={`merge-${session.id}`}
              onClick={() => props.onMerge(session.id, props.sessions.find((item: any) => item.id !== session.id)?.id)}
            >
              merge
            </button>
          </span>
        ))}
        <button type="button" onClick={props.onNew}>tab-new</button>
        <span>broadcast:{String(props.broadcasting)}</span>
        <span>broadcast-count:{props.broadcastTargetCount}</span>
        <button type="button" aria-label="toggle-broadcast" onClick={props.onToggleBroadcast}>toggle-broadcast</button>
      </div>
    )
  }
}))

vi.mock('./components/TerminalPane', () => ({
  TerminalPane: (props: any) => {
    ui.terminals.set(props.session.id, props)
    return (
      <div data-testid={`terminal-${props.session.id}`}>
        <span>{props.session.id}:{props.session.status}</span>
        <button type="button" onClick={props.onClose}>terminal-close</button>
        <button type="button" onClick={props.onReconnect}>terminal-reconnect</button>
        <button type="button" onClick={() => props.onFilesDropped(['C:\\drop.txt'])}>terminal-drop</button>
        {props.onSplit && <button type="button" onClick={props.onSplit}>terminal-split</button>}
        {props.onOpenSnippets && <button type="button" onClick={props.onOpenSnippets}>terminal-snippets</button>}
        {props.onOpenCron && <button type="button" onClick={props.onOpenCron}>terminal-cron</button>}
        <button type="button" onClick={() => props.onFullscreenOwnerChange(true)}>terminal-owner</button>
        <button type="button" aria-label="terminal-input" onClick={() => props.onInput(props.session.id, 'typed')}>terminal-input</button>
      </div>
    )
  }
}))

vi.mock('./components/Welcome', () => ({
  Welcome: (props: any) => (
    <div>
      <button type="button" onClick={() => props.onConnect(props.profiles[0])}>welcome-connect</button>
      <button type="button" onClick={props.onNew}>welcome-new</button>
    </div>
  )
}))

vi.mock('./components/ConnectionModal', () => ({
  ConnectionModal: (props: any) => {
    ui.connection = props
    const draft = {
      name: 'Saved',
      group: '',
      protocol: 'ssh',
      host: 'example.com',
      port: 22,
      username: 'root',
      authMethod: 'password',
      tunnels: [],
      askPassword: false,
      keepaliveInterval: 15000,
      proxyType: 'none'
    }
    return (
      <div className="modal-backdrop">
        <span>connection:{props.profile?.id ?? 'new'}</span>
        <span>profiles:{props.profiles.length}</span>
        <button type="button" onClick={() => void props.onSave(props.profile?.id ?? null, draft)}>modal-save</button>
        <button type="button" onClick={() => props.onDelete(props.profile)}>modal-delete</button>
        <button type="button" onClick={() => props.onDuplicate(props.profile)}>modal-duplicate</button>
        <button type="button" onClick={props.onClose}>modal-close</button>
      </div>
    )
  }
}))

vi.mock('./components/ConfirmDialog', () => ({
  ConfirmDialog: (props: any) => (
    <div role="alertdialog">
      <span>{props.title}</span>
      <span>{props.description}</span>
      <button type="button" onClick={props.onConfirm}>confirm-dialog-confirm</button>
      <button type="button" onClick={props.onCancel}>confirm-dialog-cancel</button>
    </div>
  )
}))

vi.mock('./components/PasswordPrompt', () => ({
  PasswordPrompt: (props: any) => (
    <div role="dialog">
      <button type="button" onClick={() => props.onConfirm('secret')}>password-confirm</button>
      <button type="button" onClick={props.onCancel}>password-cancel</button>
    </div>
  )
}))

vi.mock('./components/TunnelPanel', () => ({
  TunnelPanel: (props: any) => {
    ui.tunnelPanel = props
    return (
      <div>
        <span>tunnel-panel:{props.session.id}</span>
        <button type="button" onClick={() => props.onStartTunnel('tunnel-1')}>tunnel-start</button>
        <button type="button" onClick={() => props.onStopTunnel('tunnel-1')}>tunnel-stop</button>
        <button type="button" onClick={props.onEditProfile}>tunnel-edit</button>
        <button type="button" onClick={props.onClose}>tunnel-close</button>
      </div>
    )
  }
}))

vi.mock('./components/SFTPPanel', () => ({
  SFTPPanel: (props: any) => (
    <div>
      <span>sftp:{props.session.id}</span>
      <button type="button" onClick={props.onClose}>sftp-close</button>
    </div>
  )
}))

vi.mock('./components/SnippetsPanel', () => ({
  SnippetsPanel: (props: any) => {
    ui.snippetsPanel = props
    return (
      <div>
        <span>snippets:{props.snippets.length}</span>
        <button type="button" onClick={() => props.onPaste('pwd')}>snippet-paste</button>
        <button type="button" onClick={props.onClose}>snippet-close</button>
      </div>
    )
  }
}))

vi.mock('./components/SnippetQuickBar', () => ({
  SnippetQuickBar: (props: any) => (
    <div>
      <span>quick:{props.snippets.map((snippet: any) => snippet.name).join(',')}</span>
      <button type="button" onClick={() => props.onRun('uptime')}>quick-run</button>
      <button type="button" onClick={props.onManage}>quick-manage</button>
    </div>
  )
}))

vi.mock('./components/CronModal', () => ({
  CronModal: (props: any) => (
    <div>
      <span>cron:{props.sessionId}</span>
      <button type="button" onClick={props.onClose}>cron-close</button>
    </div>
  )
}))

vi.mock('./components/SystemMonitor', () => ({
  SystemMonitor: (props: any) => (
    <div>
      <span>monitor:{props.sessionId}</span>
      <button type="button" onClick={props.onClose}>monitor-close</button>
    </div>
  )
}))

vi.mock('./components/FileTransferDialog', () => ({
  FileTransferDialog: (props: any) => (
    <div>
      <span>download:{props.session.id}</span>
      <button type="button" onClick={props.onClose}>download-close</button>
    </div>
  )
}))

vi.mock('./components/TransferList', () => ({
  TransferList: (props: any) => {
    ui.transfers = props
    return (
      <div>
        <span>transfers:{props.transfers.length}</span>
        {props.transfers[0] && (
          <button type="button" onClick={() => props.onCancel(props.transfers[0].transferId)}>transfer-cancel</button>
        )}
      </div>
    )
  }
}))

vi.mock('./components/UpdateBanner', () => ({ UpdateBanner: () => null }))

describe('App', () => {
  let api: ReturnType<typeof createShellerApi>
  const listeners: Record<string, (event: any) => void> = {}
  let unsubscribers: ReturnType<typeof vi.fn>[]

  function captureEvent(name: string): void {
    ;(api.events as any)[name] = vi.fn((listener: (event: any) => void) => {
      listeners[name] = listener
      const unsubscribe = vi.fn()
      unsubscribers.push(unsubscribe)
      return unsubscribe
    })
  }

  beforeEach(() => {
    ui.terminals.clear()
    ui.sidebar = null
    ui.tabbar = null
    ui.connection = null
    ui.tunnelPanel = null
    ui.snippetsPanel = null
    ui.transfers = null
    unsubscribers = []
    for (const key of Object.keys(listeners)) delete listeners[key]

    api = createShellerApi()
    for (const name of ['onStatus', 'onTunnels', 'onRequestPassword', 'onHostKeyVerify', 'onAttach', 'onTransfer']) {
      captureEvent(name)
    }
    installShellerApi(api)
  })

  it('загружает профили и сниппеты, открывает сессию и выполняет быстрые команды', async () => {
    const profile = createProfile({ tunnels: [createTunnel()] })
    const snippet = createSnippet({ quickAccess: true, shortcut: 'Ctrl+Shift+U' })
    api.profiles.list = vi.fn(async () => [profile])
    api.snippets.list = vi.fn(async () => [snippet])

    render(<App />)

    await waitFor(() => expect(ui.sidebar?.profiles).toHaveLength(1))
    expect(ui.sidebar.loading).toBe(false)
    expect(screen.getByTestId('titlebar')).toHaveTextContent('sessions:0')
    expect(screen.getByText('Production')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'connect-first' }))
    const sessionId = [...ui.terminals.keys()][0]
    expect(ui.tabbar.sessions).toHaveLength(1)
    expect(ui.terminals.get(sessionId).session.status).toBe('connecting')
    expect(screen.getByText('Подключение')).toBeInTheDocument()

    act(() => listeners.onStatus({ sessionId, status: 'connected' }))
    expect(ui.terminals.get(sessionId).session.status).toBe('connected')
    expect(screen.getByText('Подключено')).toBeInTheDocument()
    expect(screen.getByText('quick:Uptime')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'quick-run' }))
    expect(api.sessions.write).toHaveBeenCalledWith(sessionId, 'uptime')

    fireEvent.click(screen.getByRole('button', { name: 'quick-manage' }))
    expect(screen.getByText('snippets:1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'snippet-paste' }))
    expect(api.sessions.write).toHaveBeenCalledWith(sessionId, 'pwd')
  })

  it('отправляет ввод во все подключённые сессии при мультивыполнении', async () => {
    api.profiles.list = vi.fn(async () => [createProfile()])
    api.snippets.list = vi.fn(async () => [createSnippet({ quickAccess: true })])
    render(<App />)
    await waitFor(() => expect(ui.sidebar?.profiles).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'connect-first' }))
    fireEvent.click(screen.getByRole('button', { name: 'connect-first' }))
    const ids = [...ui.terminals.keys()]
    expect(ids).toHaveLength(2)
    act(() => { for (const id of ids) listeners.onStatus({ sessionId: id, status: 'connected' }) })

    expect(screen.getByText('broadcast:false')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'toggle-broadcast' }))
    expect(screen.getByText('broadcast:true')).toBeInTheDocument()
    expect(screen.getByText('broadcast-count:2')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'terminal-input' })[0])
    expect(api.sessions.writeMany).toHaveBeenCalledWith(ids, 'typed')
    expect(api.sessions.write).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'quick-run' }))
    expect(api.sessions.writeMany).toHaveBeenCalledWith(ids, 'uptime')
  })

  it('открывает сессию по attach, обновляет статус, туннели и передачи', async () => {
    api.profiles.list = vi.fn(async () => [createProfile()])
    const { unmount } = render(<App />)
    await waitFor(() => expect(ui.sidebar?.profiles).toHaveLength(1))

    act(() => listeners.onAttach({ sessionId: 'attached', profileId: 'profile-1' }))
    expect(screen.getByTestId('terminal-attached')).toBeInTheDocument()
    expect(ui.tabbar.sessions[0]).toMatchObject({ id: 'attached', status: 'connected', isAttached: true })

    act(() => listeners.onStatus({ sessionId: 'attached', status: 'error', message: 'сбой' }))
    expect(screen.getByText('Ошибка')).toBeInTheDocument()
    expect(ui.terminals.get('attached').session.message).toBe('сбой')

    act(() =>
      listeners.onTunnels({
        sessionId: 'attached',
        tunnels: [createTunnel({ status: 'running' })]
      })
    )
    expect(ui.terminals.get('attached').session.tunnels).toHaveLength(1)
    expect(screen.getByText('1/1')).toBeInTheDocument()

    act(() =>
      listeners.onTransfer({
        transferId: 'transfer-1',
        sessionId: 'attached',
        direction: 'upload',
        fileName: 'a.txt',
        remotePath: './a.txt',
        bytesTransferred: 1,
        totalBytes: 2,
        done: false
      })
    )
    expect(screen.getByText('transfers:1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'transfer-cancel' }))
    expect(api.files.cancel).toHaveBeenCalledWith('transfer-1')

    act(() => listeners.onRequestPassword({ sessionId: 'attached' }))
    fireEvent.click(screen.getByRole('button', { name: 'password-confirm' }))
    expect(api.sessions.providePassword).toHaveBeenCalledWith('attached', 'secret')

    act(() => listeners.onHostKeyVerify({ sessionId: 'attached', hostKey: 'SHA256:abc' }))
    expect(screen.getByText('Неизвестный сервер')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'confirm-dialog-confirm' }))
    expect(api.sessions.provideHostKey).toHaveBeenCalledWith('attached', true)

    unmount()
    expect(unsubscribers).toHaveLength(6)
    for (const unsubscribe of unsubscribers) expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('создаёт, редактирует, дублирует и удаляет профили', async () => {
    const profile = createProfile()
    const copy = createProfile({ id: 'copy', name: 'Saved copy' })
    api.profiles.list = vi.fn(async () => [profile])
    api.profiles.save = vi.fn(async (id: string | null) => ({
      ok: true as const,
      profile: id
        ? createProfile({ id, name: 'Saved' })
        : createProfile({ id: 'created', name: 'Created' })
    }))
    api.profiles.duplicate = vi.fn(async () => ({ ok: true as const, profile: copy }))
    api.profiles.remove = vi.fn(async () => ({ ok: true as const }))

    render(<App />)
    await waitFor(() => expect(ui.sidebar?.profiles).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'new-profile' }))
    expect(screen.getByText('connection:new')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'modal-save' }))
    await waitFor(() =>
      expect(api.profiles.save).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ name: 'Saved', host: 'example.com' })
      )
    )
    expect(screen.queryByText('connection:new')).not.toBeInTheDocument()
    expect(await screen.findByText('Подключение создано')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'edit-first' }))
    expect(screen.getByText('connection:profile-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'modal-save' }))
    await waitFor(() => expect(api.profiles.save).toHaveBeenCalledWith('profile-1', expect.anything()))
    expect(await screen.findByText('Подключение обновлено')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'edit-first' }))
    fireEvent.click(screen.getByRole('button', { name: 'modal-duplicate' }))
    await waitFor(() => expect(api.profiles.duplicate).toHaveBeenCalledWith('profile-1'))
    expect(await screen.findByText('connection:copy')).toBeInTheDocument()
    expect(await screen.findByText('Создана копия')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'modal-delete' }))
    expect(screen.getByText('Удалить подключение?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'confirm-dialog-confirm' }))
    await waitFor(() => expect(api.profiles.remove).toHaveBeenCalledWith('copy'))
    expect(await screen.findByText('Подключение удалено')).toBeInTheDocument()
  })

  it('показывает ошибки загрузки, экспорта и отменяет импорт', async () => {
    api.profiles.list = vi.fn()
      .mockRejectedValueOnce(new Error('нет профилей'))
      .mockResolvedValue([])
    api.snippets.list = vi.fn(async () => {
      throw new Error('нет сниппетов')
    })
    api.profiles.duplicate = vi.fn(async () => {
      throw new Error('копия не создана')
    })
    api.profiles.export = vi.fn(async () => ({ ok: false, error: 'нет доступа' }))
    api.profiles.import = vi.fn(async () => ({ ok: false, error: 'Отменено' }))

    render(<App />)
    expect(await screen.findByText('Ошибка загрузки')).toBeInTheDocument()
    expect(await screen.findByText('Не удалось загрузить сниппеты')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'export-profiles' }))
    expect(await screen.findByText('Ошибка экспорта')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'import-profiles' }))
    await waitFor(() => expect(api.profiles.import).toHaveBeenCalled())
    expect(screen.queryByText('Ошибка импорта')).not.toBeInTheDocument()
  })

  it('управляет туннелями, SFTP, загрузкой, скачиванием, монитором и настройками', async () => {
    const profile = createProfile({ tunnels: [createTunnel()] })
    api.profiles.list = vi.fn(async () => [profile])
    api.files.pickUpload = vi.fn(async () => ['C:\\one.txt', 'C:\\two.txt'])
    api.sessions.startTunnel = vi.fn(async () => ({ ok: false, error: 'порт занят' }))

    render(<App />)
    await waitFor(() => expect(ui.sidebar?.profiles).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'connect-first' }))
    const sessionId = [...ui.terminals.keys()][0]
    act(() => listeners.onStatus({ sessionId, status: 'connected' }))

    fireEvent.click(screen.getByRole('button', { name: /^Туннели/ }))
    expect(screen.getByText(`tunnel-panel:${sessionId}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'tunnel-start' }))
    await waitFor(() =>
      expect(api.sessions.startTunnel).toHaveBeenCalledWith(sessionId, 'tunnel-1')
    )
    expect(await screen.findByText('Ошибка туннеля')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'tunnel-stop' }))
    await waitFor(() => expect(api.sessions.stopTunnel).toHaveBeenCalledWith(sessionId, 'tunnel-1'))
    fireEvent.click(screen.getByRole('button', { name: 'tunnel-edit' }))
    expect(screen.getByText('connection:profile-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'modal-close' }))
    fireEvent.click(screen.getByRole('button', { name: 'tunnel-close' }))
    expect(screen.queryByText(`tunnel-panel:${sessionId}`)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'SFTP' }))
    expect(screen.getByText(`sftp:${sessionId}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'sftp-close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Файлы' }))
    await waitFor(() => expect(api.files.pickUpload).toHaveBeenCalledWith('file'))
    await waitFor(() => expect(api.files.upload).toHaveBeenCalledTimes(2))
    expect(api.files.upload).toHaveBeenCalledWith(sessionId, 'C:\\one.txt', './', expect.any(String))

    fireEvent.click(screen.getByRole('button', { name: 'Скачать' }))
    expect(screen.getByText(`download:${sessionId}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'download-close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Нагрузка' }))
    expect(screen.getByText(`monitor:${sessionId}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'monitor-close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    expect(screen.getByText('connection:profile-1')).toBeInTheDocument()
  })

  it('делит, переподключает и закрывает сессии', async () => {
    api.profiles.list = vi.fn(async () => [createProfile()])
    render(<App />)
    await waitFor(() => expect(ui.sidebar?.profiles).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'connect-first' }))
    const sessionId = [...ui.terminals.keys()][0]
    act(() => listeners.onStatus({ sessionId, status: 'connected' }))

    fireEvent.click(screen.getByRole('button', { name: 'terminal-split' }))
    const terminalIds = [...ui.terminals.keys()]
    expect(terminalIds).toHaveLength(2)
    const secondaryId = terminalIds.find((id) => id !== sessionId) as string
    fireEvent.click(screen.getAllByRole('button', { name: 'terminal-close' })[1])
    expect(api.sessions.disconnect).toHaveBeenCalledWith(secondaryId)

    fireEvent.click(screen.getByRole('button', { name: 'terminal-reconnect' }))
    await waitFor(() => expect(api.sessions.disconnect).toHaveBeenCalledWith(sessionId))
    const reconnectedId = [...ui.terminals.keys()].find(
      (id) => id !== sessionId && id !== secondaryId
    ) as string
    expect(reconnectedId).toBeTruthy()
    expect(ui.tabbar.sessions[0].id).toBe(reconnectedId)

    fireEvent.click(screen.getByRole('button', { name: `detach-${reconnectedId}` }))
    await waitFor(() =>
      expect(api.sessions.detach).toHaveBeenCalledWith(reconnectedId, 'profile-1')
    )
    await waitFor(() => expect(screen.getByTestId('titlebar')).toHaveTextContent('sessions:0'))
  })

  it('выполняет сниппет по сочетанию клавиш и игнорирует поля ввода и модалки', async () => {
    api.profiles.list = vi.fn(async () => [createProfile()])
    api.snippets.list = vi.fn(async () => [
      createSnippet({ shortcut: 'Ctrl+Shift+U', command: 'uptime', quickAccess: true })
    ])
    render(<App />)
    await waitFor(() => expect(ui.sidebar?.profiles).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'connect-first' }))
    const sessionId = [...ui.terminals.keys()][0]
    act(() => listeners.onStatus({ sessionId, status: 'connected' }))

    fireEvent.keyDown(window, { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true })
    expect(api.sessions.write).toHaveBeenCalledWith(sessionId, 'uptime')

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true })
    expect(api.sessions.write).toHaveBeenCalledTimes(1)
    input.remove()

    fireEvent.click(screen.getByRole('button', { name: 'new-profile' }))
    fireEvent.keyDown(window, { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true })
    expect(api.sessions.write).toHaveBeenCalledTimes(1)
  })

  it('объединяет вкладки и переносит вторичную сессию', async () => {
    api.profiles.list = vi.fn(async () => [createProfile()])
    render(<App />)
    await waitFor(() => expect(ui.sidebar?.profiles).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'connect-first' }))
    fireEvent.click(screen.getByRole('button', { name: 'connect-first' }))
    const [first, second] = [...ui.terminals.keys()]
    expect(ui.tabbar.sessions).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: `merge-${second}` }))
    expect(ui.tabbar.sessions).toHaveLength(1)
    expect(ui.tabbar.sessions[0].id).toBe(second)
    expect(ui.tabbar.activeId).toBe(second)
    expect(screen.getByTestId(`terminal-${first}`)).toBeInTheDocument()
    expect(screen.getByTestId(`terminal-${second}`)).toBeInTheDocument()
  })
})
