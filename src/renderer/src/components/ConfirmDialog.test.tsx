// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('показывает заголовок, описание и кнопку подтверждения', () => {
    render(
      <ConfirmDialog
        title="Удалить подключение?"
        description="Профиль будет удалён."
        confirmLabel="Удалить"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Удалить подключение?')).toBeInTheDocument()
    expect(screen.getByText('Профиль будет удалён.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /удалить/i })).toBeInTheDocument()
  })

  it('вызывает действия и не закрывается по клику внутри', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Удалить"
        description="Описание"
        confirmLabel="Удалить"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onCancel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /удалить/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('закрывается по клику на фон', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Удалить"
        description="Описание"
        confirmLabel="Удалить"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    )

    fireEvent.mouseDown(document.querySelector('.confirm-backdrop') as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('блокирует кнопки во время выполнения', () => {
    render(
      <ConfirmDialog
        title="Удалить"
        description="Описание"
        confirmLabel="Удалить"
        busy
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })
})
