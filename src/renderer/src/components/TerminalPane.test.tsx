// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalPane } from './TerminalPane'
import { createSession, createShellerApi, installShellerApi } from '../../../test/api'

const xtermMock = vi.hoisted(() => {
  const instances: MockTerminal[] = []
  const fitInstances: MockFitAddon[] = []

  class MockTerminal {
    cols = 80
    rows = 24
    config: unknown
    dataCb?: (data: string) => void
    resizeCb?: (size: { cols: number; rows: number }) => void
    selectionCb?: () => void
    keyHandler?: (event: KeyboardEvent) => boolean
    loadAddon = vi.fn()
    open = vi.fn()
    focus = vi.fn()
    write = vi.fn()
    paste = vi.fn()
    getSelection = vi.fn(() => '')
    clearSelection = vi.fn()
    hasSelection = vi.fn(() => false)
    dispose = vi.fn()
    attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      this.keyHandler = handler
    })
    onData = vi.fn((callback: (data: string) => void) => {
      this.dataCb = callback
      return { dispose: vi.fn() }
    })
    onResize = vi.fn((callback: (size: { cols: number; rows: number }) => void) => {
      this.resizeCb = callback
      return { dispose: vi.fn() }
    })
    onSelectionChange = vi.fn((callback: () => void) => {
      this.selectionCb = callback
      return { dispose: vi.fn() }
    })

    constructor(config: unknown) {
      this.config = config
      instances.push(this)
    }
  }

  class MockFitAddon {
    fit = vi.fn()
    constructor() {
      fitInstances.push(this)
    }
  }

  class MockWebLinksAddon {
    constructor(public handler: (event: MouseEvent, uri: string) => void) {}
  }

  return { instances, fitInstances, MockTerminal, MockFitAddon, MockWebLinksAddon }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xtermMock.MockTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xtermMock.MockFitAddon }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: xtermMock.MockWebLinksAddon }))

describe('TerminalPane', () => {
  let api: ReturnType<typeof createShellerApi>
  let dataListener: ((event: { sessionId: string; data: string }) => void) | undefined
  let fullscreenListener: ((value: boolean) => void) | undefined

  beforeEach(() => {
    xtermMock.instances.length = 0
    xtermMock.fitInstances.length = 0
    dataListener = undefined
    fullscreenListener = undefined

    api = createShellerApi()
    api.events.onData = vi.fn((listener) => {
      dataListener = listener
      return vi.fn()
    })
    api.window.onFullscreenChange = vi.fn((listener) => {
      fullscreenListener = listener
      return vi.fn()
    })
    installShellerApi(api)

    Object.defineProperty(document, 'fonts', {
      value: { ready: Promise.resolve() },
      configurable: true
    })
  })

  it('создаёт терминал, подписывается на события и подключается', async () => {
    render(
      <TerminalPane
        session={createSession()}
        active
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        onFilesDropped={vi.fn()}
      />
    )

    await waitFor(() => expect(xtermMock.instances).toHaveLength(1))
    const terminal = xtermMock.instances[0]
    expect(terminal.open).toHaveBeenCalled()
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    expect(terminal.config).toMatchObject({ fontSize: 13.5, scrollback: 30000 })
    expect(api.sessions.connect).toHaveBeenCalledWith({
      sessionId: 'session-1',
      profileId: 'profile-1',
      cols: 80,
      rows: 24
    })

    act(() => dataListener?.({ sessionId: 'other', data: 'skip' }))
    act(() => dataListener?.({ sessionId: 'session-1', data: 'hello' }))
    expect(terminal.write).toHaveBeenCalledWith('hello')

    act(() => terminal.dataCb?.('ls\n'))
    expect(api.sessions.write).toHaveBeenCalledWith('session-1', 'ls\n')

    act(() => terminal.resizeCb?.({ cols: 120, rows: 40 }))
    expect(api.sessions.resize).toHaveBeenCalledWith('session-1', 120, 40)
  })

  it('передаёт ввод через onInput и показывает индикатор мультивыполнения', async () => {
    const onInput = vi.fn()
    render(
      <TerminalPane
        session={createSession()}
        active
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        onFilesDropped={vi.fn()}
        onInput={onInput}
        broadcasting
      />
    )

    await waitFor(() => expect(xtermMock.instances).toHaveLength(1))
    act(() => xtermMock.instances[0].dataCb?.('ls\n'))
    expect(onInput).toHaveBeenCalledWith('session-1', 'ls\n')
    expect(api.sessions.write).not.toHaveBeenCalled()
    expect(screen.getByText('MULTI')).toBeInTheDocument()
  })

  it('копирует выделение и вставляет из буфера', async () => {
    api.clipboard.readText = vi.fn(() => 'pwd')
    render(
      <TerminalPane
        session={createSession()}
        active
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        onFilesDropped={vi.fn()}
      />
    )

    await waitFor(() => expect(xtermMock.instances).toHaveLength(1))
    const terminal = xtermMock.instances[0]
    terminal.hasSelection = vi.fn(() => true)
    terminal.getSelection = vi.fn(() => 'selected')

    act(() => terminal.selectionCb?.())
    fireEvent.click(screen.getByTitle('Копировать'))
    expect(api.clipboard.writeText).toHaveBeenCalledWith('selected')
    expect(terminal.clearSelection).toHaveBeenCalled()

    fireEvent.click(screen.getByTitle('Вставить'))
    expect(terminal.paste).toHaveBeenCalledWith('pwd')
    expect(terminal.focus).toHaveBeenCalled()
  })

  it('обрабатывает горячие клавиши копирования и вставки', async () => {
    render(
      <TerminalPane
        session={createSession()}
        active
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        onFilesDropped={vi.fn()}
      />
    )

    await waitFor(() => expect(xtermMock.instances).toHaveLength(1))
    const terminal = xtermMock.instances[0]
    terminal.hasSelection = vi.fn(() => true)
    terminal.getSelection = vi.fn(() => 'copy me')
    api.clipboard.readText = vi.fn(() => 'paste me')

    const copyEvent = {
      type: 'keydown',
      key: 'C',
      ctrlKey: true,
      shiftKey: true,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent
    expect(terminal.keyHandler?.(copyEvent)).toBe(false)
    expect(api.clipboard.writeText).toHaveBeenCalledWith('copy me')

    const pasteEvent = {
      type: 'keydown',
      key: 'V',
      ctrlKey: true,
      shiftKey: true,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent
    expect(terminal.keyHandler?.(pasteEvent)).toBe(false)
    expect(terminal.paste).toHaveBeenCalledWith('paste me')

    expect(terminal.keyHandler?.({ type: 'keydown', key: 'A' } as KeyboardEvent)).toBe(true)
  })

  it('показывает ошибку подключения и действия восстановления', async () => {
    api.sessions.connect = vi.fn(async () => ({ ok: false, error: 'Доступ запрещён' }))
    const onReconnect = vi.fn()
    const onClose = vi.fn()
    render(
      <TerminalPane
        session={createSession()}
        active
        onReconnect={onReconnect}
        onClose={onClose}
        onFilesDropped={vi.fn()}
      />
    )

    expect(await screen.findByText('Доступ запрещён')).toBeInTheDocument()
    expect(screen.getByText('Соединение прервано')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Переподключиться/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Закрыть$/ }))
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('показывает процесс подключения и отмену', () => {
    const onClose = vi.fn()
    render(
      <TerminalPane
        session={createSession({ status: 'connecting' })}
        active
        onReconnect={vi.fn()}
        onClose={onClose}
        onFilesDropped={vi.fn()}
      />
    )

    expect(screen.getByText('Устанавливаем соединение')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('передаёт перетащенные файлы и показывает оверлей', async () => {
    const onFilesDropped = vi.fn()
    api.files.getPathForFile = vi.fn(() => 'C:\\drop.txt')
    const { container } = render(
      <TerminalPane
        session={createSession()}
        active
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        onFilesDropped={onFilesDropped}
      />
    )
    await waitFor(() => expect(xtermMock.instances).toHaveLength(1))
    const pane = container.querySelector('.terminal-pane') as HTMLElement

    fireEvent.dragOver(pane, { dataTransfer: { types: ['Files'], dropEffect: '' } })
    expect(screen.getByText('Отпустите для загрузки на сервер')).toBeInTheDocument()

    fireEvent.dragLeave(pane)
    expect(screen.queryByText('Отпустите для загрузки на сервер')).not.toBeInTheDocument()

    fireEvent.drop(pane, {
      dataTransfer: { files: [new File(['x'], 'drop.txt')], types: ['Files'] }
    })
    expect(onFilesDropped).toHaveBeenCalledWith(['C:\\drop.txt'])
  })

  it('игнорирует drag-and-drop для telnet', async () => {
    const onFilesDropped = vi.fn()
    const { container } = render(
      <TerminalPane
        session={createSession({ profile: { ...createSession().profile, protocol: 'telnet' } })}
        active
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        onFilesDropped={onFilesDropped}
      />
    )
    await waitFor(() => expect(xtermMock.instances).toHaveLength(1))
    const pane = container.querySelector('.terminal-pane') as HTMLElement

    fireEvent.dragOver(pane, { dataTransfer: { types: ['Files'], dropEffect: '' } })
    fireEvent.drop(pane, {
      dataTransfer: { files: [new File(['x'], 'drop.txt')], types: ['Files'] }
    })
    expect(onFilesDropped).not.toHaveBeenCalled()
    expect(screen.queryByText('Отпустите для загрузки на сервер')).not.toBeInTheDocument()
  })

  it('управляет полноэкранным режимом', async () => {
    api.window.isFullscreen = vi.fn(async () => true)
    const onFullscreenOwnerChange = vi.fn()
    const { unmount } = render(
      <TerminalPane
        session={createSession()}
        active
        isFullscreenOwner
        onFullscreenOwnerChange={onFullscreenOwnerChange}
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        onFilesDropped={vi.fn()}
      />
    )

    expect(await screen.findByTitle('Выйти из полноэкранного режима')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Выйти из полноэкранного режима'))
    expect(api.window.setFullscreen).toHaveBeenCalledWith(false)
    expect(onFullscreenOwnerChange).toHaveBeenCalledWith(false)

    act(() => fullscreenListener?.(true))
    unmount()
    expect(api.window.setFullscreen).toHaveBeenCalledWith(false)
  })

  it('вызывает инструменты панели', async () => {
    const onSplit = vi.fn()
    const onOpenSnippets = vi.fn()
    const onOpenCron = vi.fn()
    render(
      <TerminalPane
        session={createSession()}
        active
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        onFilesDropped={vi.fn()}
        onSplit={onSplit}
        onOpenSnippets={onOpenSnippets}
        onOpenCron={onOpenCron}
      />
    )

    fireEvent.click(screen.getByTitle('Сниппеты'))
    fireEvent.click(screen.getByTitle('Cron планировщик'))
    fireEvent.click(screen.getByTitle('Разделить экран'))
    expect(onOpenSnippets).toHaveBeenCalledTimes(1)
    expect(onOpenCron).toHaveBeenCalledTimes(1)
    expect(onSplit).toHaveBeenCalledTimes(1)
  })
})
