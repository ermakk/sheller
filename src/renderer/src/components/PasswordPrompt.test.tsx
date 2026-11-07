// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PasswordPrompt } from './PasswordPrompt'

describe('PasswordPrompt', () => {
  it('передаёт введённый пароль по кнопке', () => {
    const onConfirm = vi.fn()
    render(<PasswordPrompt onConfirm={onConfirm} onCancel={vi.fn()} />)

    const input = screen.getByPlaceholderText('Пароль')
    fireEvent.change(input, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: /войти/i }))

    expect(onConfirm).toHaveBeenCalledWith('secret')
  })

  it('передаёт пароль по Enter и поддерживает отмену', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<PasswordPrompt onConfirm={onConfirm} onCancel={onCancel} />)

    const input = screen.getByPlaceholderText('Пароль')
    fireEvent.change(input, { target: { value: 'pass' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith('pass')

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('переключает видимость пароля и закрывается по фону', () => {
    const onCancel = vi.fn()
    const { container } = render(<PasswordPrompt onConfirm={vi.fn()} onCancel={onCancel} />)

    const input = screen.getByPlaceholderText('Пароль')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }))
    expect(input).toHaveAttribute('type', 'password')

    fireEvent.mouseDown(container.firstElementChild as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
