// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SFTPPanel } from './SFTPPanel'
import { createSession, createShellerApi, installShellerApi } from '../../../test/api'
import type { RemoteFile } from '@shared/types'

const file = (overrides: Partial<RemoteFile> = {}): RemoteFile => ({
  name: 'file.txt',
  path: '/file.txt',
  isDirectory: false,
  size: 2048,
  mtime: 1,
  ...overrides
})

describe('SFTPPanel', () => {
  let api: ReturnType<typeof createShellerApi>

  beforeEach(() => {
    api = createShellerApi()
    installShellerApi(api)
  })

  it('загружает папку и сортирует каталоги перед файлами', async () => {
    api.files.listRemote = vi.fn(async () => [
      file({ name: 'z.txt', path: '/z.txt' }),
      file({ name: 'work', path: '/work', isDirectory: true }),
      file({ name: 'a.txt', path: '/a.txt' }),
      file({ name: 'data', path: '/data', isDirectory: true })
    ])

    const { container } = render(<SFTPPanel session={createSession()} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('a.txt')).toBeInTheDocument())
    expect(api.files.listRemote).toHaveBeenCalledWith('session-1', '~')
    expect(screen.getAllByText('2.0 КБ')).toHaveLength(2)

    const names = Array.from(container.querySelectorAll('.sftp-item')).map(
      (item) => item.querySelector('span')?.textContent
    )
    expect(names).toEqual(['data', 'work', 'a.txt', 'z.txt'])
  })

  it('показывает и закрывает ошибку загрузки', async () => {
    api.files.listRemote = vi.fn(async () => {
      throw new Error('доступ запрещён')
    })
    render(<SFTPPanel session={createSession()} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('доступ запрещён')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByText('доступ запрещён')).not.toBeInTheDocument()
  })

  it('переходит по папкам и возвращается на уровень выше', async () => {
    api.files.listRemote = vi.fn(async (_sessionId: string, path: string) => {
      if (path === '~' || path === '/') {
        return [file({ name: 'home', path: '/home', isDirectory: true })]
      }
      return [file({ name: 'inner.txt', path: '/home/inner.txt' })]
    })

    render(<SFTPPanel session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())

    fireEvent.doubleClick(screen.getByText('home'))
    await waitFor(() => expect(screen.getByText('/home')).toBeInTheDocument())
    expect(await screen.findByText('inner.txt')).toBeInTheDocument()

    const up = document.querySelectorAll('.sftp-toolbar button')[0] as HTMLElement
    expect(up).toBeEnabled()
    fireEvent.click(up)
    await waitFor(() => expect(api.files.listRemote).toHaveBeenCalledWith('session-1', '/'))
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('скачивает файл через выбранный каталог', async () => {
    api.files.listRemote = vi.fn(async () => [file()])
    api.files.pickDownload = vi.fn(async () => 'C:\\Downloads')

    render(<SFTPPanel session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('file.txt')).toBeInTheDocument())

    const row = screen.getByText('file.txt').closest('.sftp-item') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button')[0])

    await waitFor(() =>
      expect(api.files.download).toHaveBeenCalledWith(
        'session-1',
        '/file.txt',
        'C:\\Downloads',
        expect.any(String)
      )
    )
  })

  it('загружает выбранные файлы', async () => {
    api.files.listRemote = vi.fn(async () => [])
    api.files.pickUpload = vi.fn(async () => ['C:\\upload.txt'])

    const { container } = render(<SFTPPanel session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('~')).toBeInTheDocument())

    fireEvent.click(container.querySelectorAll('.sftp-toolbar button')[2])
    await waitFor(() =>
      expect(api.files.upload).toHaveBeenCalledWith('session-1', 'C:\\upload.txt', '~', expect.any(String))
    )
  })

  it('удаляет файл после подтверждения', async () => {
    api.files.listRemote = vi.fn(async () => [file()])
    api.files.deleteRemote = vi.fn(async () => ({ ok: true }))

    render(<SFTPPanel session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('file.txt')).toBeInTheDocument())

    const row = screen.getByText('file.txt').closest('.sftp-item') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button')[1])
    expect(screen.getByText('Удалить файл?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(api.files.deleteRemote).toHaveBeenCalledWith('session-1', '/file.txt'))
    await waitFor(() => expect(screen.queryByText('Удалить файл?')).not.toBeInTheDocument())
    expect(api.files.listRemote).toHaveBeenCalledTimes(2)
  })

  it('оставляет диалог удаления при ошибке и показывает её', async () => {
    api.files.listRemote = vi.fn(async () => [
      file({ name: 'folder', path: '/folder', isDirectory: true })
    ])
    api.files.deleteRemote = vi.fn(async () => ({ ok: false, error: 'нет прав' }))

    render(<SFTPPanel session={createSession()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument())

    const row = screen.getByText('folder').closest('.sftp-item') as HTMLElement
    fireEvent.click(within(row).getByRole('button'))
    expect(screen.getByText('Удалить папку?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(screen.getByText('нет прав')).toBeInTheDocument())
    expect(screen.getByText('Удалить папку?')).toBeInTheDocument()
  })

  it('обрабатывает исключение удаления и закрывает панель', async () => {
    api.files.listRemote = vi.fn(async () => [file()])
    api.files.deleteRemote = vi.fn(async () => {
      throw new Error('сбой соединения')
    })
    const onClose = vi.fn()

    render(<SFTPPanel session={createSession()} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('file.txt')).toBeInTheDocument())

    const row = screen.getByText('file.txt').closest('.sftp-item') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(screen.getByText('сбой соединения')).toBeInTheDocument())

    fireEvent.click(document.querySelector('.sftp-header button') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
