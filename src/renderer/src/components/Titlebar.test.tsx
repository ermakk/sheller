// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Titlebar } from './Titlebar'

describe('Titlebar', () => {
  it('скрывает счётчик без сессий', () => {
    render(<Titlebar sessionCount={0} />)
    expect(screen.getByText('Sheller')).toBeInTheDocument()
    expect(screen.queryByText(/сессий|сессия|сессии/)).not.toBeInTheDocument()
  })

  it('склоняет подпись для одной сессии', () => {
    render(<Titlebar sessionCount={1} />)
    expect(screen.getByText('1 сессия')).toBeInTheDocument()
  })

  it('склоняет подпись для нескольких сессий', () => {
    const { rerender } = render(<Titlebar sessionCount={3} />)
    expect(screen.getByText('3 сессии')).toBeInTheDocument()

    rerender(<Titlebar sessionCount={7} />)
    expect(screen.getByText('7 сессий')).toBeInTheDocument()
  })
})
