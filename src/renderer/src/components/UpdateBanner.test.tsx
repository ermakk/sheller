// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'
import { createShellerApi, createUpdaterApi, installShellerApi } from '../../../test/api'
import type { UpdateStatusEvent, UpdateProgressEvent, UpdateErrorEvent } from '@shared/types'

describe('UpdateBanner', () => {
  let updater: ReturnType<typeof createUpdaterApi>
  let statusListener: ((event: UpdateStatusEvent) => void) | undefined
  let progressListener: ((event: UpdateProgressEvent) => void) | undefined
  let errorListener: ((event: UpdateErrorEvent) => void) | undefined
  let offStatus: ReturnType<typeof vi.fn>
  let offProgress: ReturnType<typeof vi.fn>
  let offError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    statusListener = undefined
    progressListener = undefined
    errorListener = undefined
    offStatus = vi.fn()
    offProgress = vi.fn()
    offError = vi.fn()

    updater = createUpdaterApi()
    updater.onStatus = vi.fn((listener) => {
      statusListener = listener
      return offStatus
    })
    updater.onProgress = vi.fn((listener) => {
      progressListener = listener
      return offProgress
    })
    updater.onError = vi.fn((listener) => {
      errorListener = listener
      return offError
    })
    installShellerApi(createShellerApi(), updater)
  })

  const emit = (event: UpdateStatusEvent): void => {
    act(() => statusListener?.(event))
  }

  it('не отображается в состоянии idle', () => {
    const { container } = render(<UpdateBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('показывает проверку и отписывается при размонтировании', () => {
    const { unmount } = render(<UpdateBanner />)
    emit({ state: 'checking' })

    expect(screen.getByText('Проверка обновлений')).toBeInTheDocument()
    expect(screen.getByText('Связываемся с GitHub Releases…')).toBeInTheDocument()

    unmount()
    expect(offStatus).toHaveBeenCalledTimes(1)
    expect(offProgress).toHaveBeenCalledTimes(1)
    expect(offError).toHaveBeenCalledTimes(1)
  })

  it('скачивает доступное обновление и показывает прогресс', async () => {
    render(<UpdateBanner />)
    emit({ state: 'available', version: '1.2.3' })

    expect(screen.getByText('Доступно обновление v1.2.3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
    await waitFor(() => expect(updater.download).toHaveBeenCalledTimes(1))

    emit({ state: 'downloading', version: '1.2.3' })
    act(() => {
      progressListener?.({ percent: 50, transferred: 1024, total: 2048, bytesPerSecond: 512 })
    })

    expect(screen.getByText('Загрузка обновления v1.2.3')).toBeInTheDocument()
    expect(screen.getByText('50% · 1.0 КБ из 2.0 КБ')).toBeInTheDocument()
    expect(screen.getByText('512 Б/с')).toBeInTheDocument()

    emit({ state: 'ready' })
    fireEvent.click(screen.getByRole('button', { name: /Перезапустить/ }))
    expect(updater.install).toHaveBeenCalledTimes(1)
  })

  it('показывает ошибку обновления и повторяет скачивание', async () => {
    render(<UpdateBanner />)
    emit({ state: 'downloading' })
    act(() => errorListener?.({ message: 'Обрыв сети' }))

    expect(screen.getByText('Не удалось обновить приложение')).toBeInTheDocument()
    expect(screen.getByText('Обрыв сети')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }))
    await waitFor(() => expect(updater.download).toHaveBeenCalledTimes(1))
  })

  it('повторяет проверку после ошибки и показывает её результат', async () => {
    updater.check = vi.fn(async () => ({ ok: false, error: 'Нет соединения' }))
    render(<UpdateBanner />)
    act(() => statusListener?.({ state: 'error' }))

    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }))
    await waitFor(() => expect(updater.check).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Нет соединения')).toBeInTheDocument()
  })

  it('показывает ошибку запуска скачивания', async () => {
    updater.download = vi.fn(async () => ({ ok: false, error: 'Нет доступа' }))
    render(<UpdateBanner />)
    emit({ state: 'available' })

    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }))
    expect(await screen.findByText('Нет доступа')).toBeInTheDocument()
  })

  it('скрывается по кнопке и снова показывается при новом событии', () => {
    render(<UpdateBanner />)
    emit({ state: 'available' })

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть уведомление об обновлении' }))
    expect(screen.queryByText('Доступно обновление')).not.toBeInTheDocument()

    emit({ state: 'checking' })
    expect(screen.getByText('Проверка обновлений')).toBeInTheDocument()
  })

  it('показывает обновление без версии и нулевой прогресс', () => {
    render(<UpdateBanner />)
    emit({ state: 'available' })
    expect(screen.getByText('Доступно обновление')).toBeInTheDocument()

    emit({ state: 'downloading' })
    act(() => {
      progressListener?.({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
    })
    expect(screen.getByText('Загрузка обновления')).toBeInTheDocument()
    expect(screen.getByText('0% · 0 Б из 0 Б')).toBeInTheDocument()
    expect(screen.getByText('0 Б/с')).toBeInTheDocument()
  })
})
