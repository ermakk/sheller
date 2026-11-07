// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toasts } from './Toasts'
import type { ToastMessage } from '../types'

const toast = (overrides: Partial<ToastMessage> = {}): ToastMessage => ({
  id: 'toast-1',
  kind: 'success',
  title: 'Готово',
  ...overrides
})

describe('Toasts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('показывает уведомления всех типов с описанием', () => {
    render(
      <Toasts
        toasts={[
          toast(),
          toast({ id: 'toast-2', kind: 'error', title: 'Ошибка', description: 'Описание' }),
          toast({ id: 'toast-3', kind: 'info', title: 'Инфо' })
        ]}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getAllByRole('status')).toHaveLength(3)
    expect(screen.getByText('Готово')).toBeInTheDocument()
    expect(screen.getByText('Ошибка')).toBeInTheDocument()
    expect(screen.getByText('Описание')).toBeInTheDocument()
    expect(screen.getByText('Инфо')).toBeInTheDocument()
  })

  it('закрывается по кнопке', () => {
    const onDismiss = vi.fn()
    render(<Toasts toasts={[toast()]} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }))
    expect(onDismiss).toHaveBeenCalledWith('toast-1')
  })

  it('автоматически скрывается через 4.6 секунды', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toasts toasts={[toast()]} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(4599)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledWith('toast-1')
  })
})
