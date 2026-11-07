// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TabBar } from './TabBar'
import { createSession } from '../../../test/api'

const sessions = [
  createSession({ id: 'one', profile: { ...createSession().profile, name: 'Alpha' } }),
  createSession({ id: 'two', status: 'error', profile: { ...createSession().profile, id: 'profile-2', name: 'Beta' } })
]

describe('TabBar', () => {
  it('показывает вкладки, статусы и активную сессию', () => {
    render(
      <TabBar sessions={sessions} activeId="one" onActivate={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Подключено')).toBeInTheDocument()
    expect(screen.getByText('Ошибка')).toBeInTheDocument()
  })

  it('активирует, закрывает и создаёт сессии', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const onNew = vi.fn()
    render(
      <TabBar sessions={sessions} activeId="one" onActivate={onActivate} onClose={onClose} onNew={onNew} />
    )

    fireEvent.click(screen.getByText('Beta'))
    expect(onActivate).toHaveBeenCalledWith('two')

    fireEvent.keyDown(screen.getAllByRole('tab')[1], { key: 'Enter' })
    fireEvent.keyDown(screen.getAllByRole('tab')[1], { key: ' ' })
    expect(onActivate).toHaveBeenCalledTimes(3)

    fireEvent(screen.getAllByRole('tab')[1], new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    fireEvent.click(screen.getAllByTitle('Закрыть сессию')[0])
    expect(onClose).toHaveBeenCalledWith('two')
    expect(onClose).toHaveBeenCalledWith('one')

    fireEvent.click(screen.getByTitle('Новое подключение'))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('открывает меню вкладки и выносит сессию', () => {
    const onActivate = vi.fn()
    const onDetach = vi.fn()
    render(
      <TabBar
        sessions={sessions}
        activeId="one"
        onActivate={onActivate}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onDetach={onDetach}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Меню вкладки' })[0])
    expect(onActivate).toHaveBeenCalledWith('one')
    fireEvent.click(screen.getByText('Вынести в отдельное окно'))
    expect(onDetach).toHaveBeenCalledWith('one')
    expect(screen.queryByText('Вынести в отдельное окно')).not.toBeInTheDocument()
  })

  it('объединяет вкладки через контекстное меню', () => {
    const onMerge = vi.fn()
    render(
      <TabBar
        sessions={sessions}
        activeId="one"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onMerge={onMerge}
      />
    )

    fireEvent.contextMenu(screen.getAllByRole('tab')[0], { clientX: 10, clientY: 10 })
    expect(screen.getByText('Объединить с…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    expect(onMerge).toHaveBeenCalledWith('one', 'two')
  })

  it('переключает режим мультивыполнения', () => {
    const onToggleBroadcast = vi.fn()
    const props = {
      sessions,
      activeId: 'one',
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onNew: vi.fn(),
      onToggleBroadcast,
      broadcastTargetCount: 2
    }
    const { rerender } = render(<TabBar {...props} broadcasting={false} />)

    const toggle = screen.getByRole('button', { name: 'Мультивыполнение' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(onToggleBroadcast).toHaveBeenCalledTimes(1)

    rerender(<TabBar {...props} broadcasting />)
    expect(screen.getByRole('button', { name: 'Мультивыполнение' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('закрывает меню по клику вне и по скроллу', () => {
    render(
      <TabBar
        sessions={sessions}
        activeId="one"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onDetach={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Меню вкладки' })[0])
    expect(screen.getByText('Вынести в отдельное окно')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Вынести в отдельное окно')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Меню вкладки' })[0])
    fireEvent.scroll(window)
    expect(screen.queryByText('Вынести в отдельное окно')).not.toBeInTheDocument()
  })
})
