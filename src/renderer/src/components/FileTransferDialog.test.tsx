// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTransferDialog } from './FileTransferDialog'
import { createSession, createShellerApi, installShellerApi } from '../../../test/api'
import type { RemoteFile } from '@shared/types'

const file = (overrides: Partial<RemoteFile> = {}): RemoteFile => ({
  name: 'file.txt',
  path: '/file.txt',
  isDirectory: false,
  size: 1024,
  mtime: 1,
  ...overrides
})

describe('FileTransferDialog', () => {
  let api: ReturnType<typeof createShellerApi>

  beforeEach(() => {
    api = createShellerApi()
    installShellerApi(api)
  })

  it('загружает и сортирует содержимое папки', async () => {
    api.files.listRemote = vi.fn(async () => [
      file({ name: 'b.txt', path: '/b.txt' }),
      file({ name: 'zdir', path: '/zdir', isDirectory: true }),
      file({ name: 'a.txt', path: '/a.txt' })
    ])

    const { container } = render(<FileTransferDialog session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('a.txt')).toBeInTheDocument())

    expect(api.files.listRemote).toHaveBeenCalledWith('session-1', '~')
    expect(screen.getAllByText('1.0 КБ')).toHaveLength(2)
    const names = Array.from(container.querySelectorAll('.file-browser-name')).map((node) => node.textContent)
    expect(names).toEqual(['zdir', 'a.txt', 'b.txt'])
  })

  it('открывает папку двойным кликом и поднимается наверх', async () => {
    api.files.listRemote = vi.fn(async (_sessionId: string, path: string) => {
      if (path === '~' || path === '/') {
        return [file({ name: 'sub', path: '/sub', isDirectory: true })]
      }
      return [file({ name: 'deep.txt', path: '/sub/deep.txt' })]
    })

    render(<FileTransferDialog session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('sub')).toBeInTheDocument())
    fireEvent.doubleClick(screen.getByText('sub'))
    await waitFor(() => expect(screen.getByText('deep.txt')).toBeInTheDocument())

    fireEvent.click(document.querySelector('.file-browser-toolbar button') as HTMLElement)
    await waitFor(() => expect(screen.getByText('sub')).toBeInTheDocument())
  })

  it('скачивает выбранный файл и закрывает диалог', async () => {
    api.files.listRemote = vi.fn(async () => [file()])
    api.files.pickDownload = vi.fn(async () => 'C:\\Downloads')
    api.files.download = vi.fn(async () => ({ ok: true }))
    const onClose = vi.fn()

    render(<FileTransferDialog session={createSession()} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('file.txt')).toBeInTheDocument())

    fireEvent.click(screen.getByText('file.txt'))
    expect(screen.getByText('Выбрано: file.txt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /скачать/i }))

    await waitFor(() =>
      expect(api.files.download).toHaveBeenCalledWith(
        'session-1',
        '/file.txt',
        'C:\\Downloads',
        expect.any(String)
      )
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('не начинает скачивание без выбранного каталога', async () => {
    api.files.listRemote = vi.fn(async () => [file()])
    api.files.pickDownload = vi.fn(async () => null)

    render(<FileTransferDialog session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('file.txt')).toBeInTheDocument())
    fireEvent.click(screen.getByText('file.txt'))
    fireEvent.click(screen.getByRole('button', { name: /скачать/i }))

    await waitFor(() => expect(api.files.pickDownload).toHaveBeenCalled())
    expect(api.files.download).not.toHaveBeenCalled()
  })

  it('показывает ошибку скачивания', async () => {
    api.files.listRemote = vi.fn(async () => [file()])
    api.files.pickDownload = vi.fn(async () => 'C:\\Downloads')
    api.files.download = vi.fn(async () => ({ ok: false, error: 'нет места' }))

    render(<FileTransferDialog session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('file.txt')).toBeInTheDocument())
    fireEvent.click(screen.getByText('file.txt'))
    fireEvent.click(screen.getByRole('button', { name: /скачать/i }))

    expect(await screen.findByText('нет места')).toBeInTheDocument()
  })

  it('показывает ошибку загрузки списка и пустую папку', async () => {
    api.files.listRemote = vi.fn(async () => {
      throw new Error('SFTP недоступен')
    })
    const { unmount } = render(<FileTransferDialog session={createSession()} onClose={vi.fn()} />)
    expect(await screen.findByText('SFTP недоступен')).toBeInTheDocument()

    unmount()
    api.files.listRemote = vi.fn(async () => [])
    render(<FileTransferDialog session={createSession()} onClose={vi.fn()} />)
    expect(await screen.findByText('Папка пуста')).toBeInTheDocument()
  })

  it('закрывается по кнопке, отмене и фону', async () => {
    api.files.listRemote = vi.fn(async () => [])
    const onClose = vi.fn()
    const { unmount } = render(<FileTransferDialog session={createSession()} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('Папка пуста')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)

    unmount()
  })
})
