// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransferList } from './TransferList'
import type { FileTransfer } from '../types'

const transfer = (overrides: Partial<FileTransfer> = {}): FileTransfer => ({
  transferId: 'transfer-1',
  sessionId: 'session-1',
  direction: 'upload',
  fileName: 'file.txt',
  remotePath: '/tmp',
  bytesTransferred: 512,
  totalBytes: 1024,
  done: false,
  ...overrides
})

describe('TransferList', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('не рендерится без передач', () => {
    const { container } = render(<TransferList transfers={[]} onDismiss={vi.fn()} onCancel={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('показывает прогресс загрузки и отменяет активную передачу', () => {
    const onCancel = vi.fn()
    const onDismiss = vi.fn()
    render(<TransferList transfers={[transfer()]} onDismiss={onDismiss} onCancel={onCancel} />)

    expect(screen.getByText('file.txt')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('Загрузка на сервер')).toBeInTheDocument()
    expect(screen.getByText(/512 Б из 1.0 КБ/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    expect(onCancel).toHaveBeenCalledWith('transfer-1')
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('показывает завершённое скачивание и убирает его по кнопке', () => {
    const onDismiss = vi.fn()
    render(
      <TransferList
        transfers={[transfer({ direction: 'download', done: true })]}
        onDismiss={onDismiss}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Готово')).toBeInTheDocument()
    expect(screen.getByText('Скачивание с сервера')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Убрать' }))
    expect(onDismiss).toHaveBeenCalledWith('transfer-1')
  })

  it('показывает ошибку и завершённую передачу без размеров', () => {
    render(
      <TransferList
        transfers={[
          transfer({ transferId: 'err', error: 'нет доступа', done: true }),
          transfer({ transferId: 'zero', done: true, totalBytes: 0 })
        ]}
        onDismiss={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Ошибка')).toBeInTheDocument()
    expect(screen.getByText('нет доступа')).toBeInTheDocument()
    expect(screen.getAllByText('Готово')).toHaveLength(1)
  })

  it('автоматически скрывает успешно завершённую передачу', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(
      <TransferList
        transfers={[transfer({ done: true })]}
        onDismiss={onDismiss}
        onCancel={vi.fn()}
      />
    )

    act(() => {
      vi.advanceTimersByTime(3200)
    })
    expect(onDismiss).toHaveBeenCalledWith('transfer-1')
  })
})
