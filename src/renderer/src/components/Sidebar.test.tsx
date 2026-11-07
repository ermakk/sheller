// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import { createProfile, createSession } from '../../../test/api'

const profiles = [
  createProfile({ id: 'a', name: 'Alpha', host: 'alpha.example', group: 'Prod' }),
  createProfile({ id: 'b', name: 'Beta', host: 'beta.example', group: 'Prod' }),
  createProfile({ id: 'c', name: 'Gamma', host: 'gamma.example', group: '' })
]

describe('Sidebar', () => {
  it('показывает скелетоны и пустое состояние', () => {
    const { rerender } = render(
      <Sidebar
        profiles={[]}
        sessions={[]}
        loading
        onConnect={vi.fn()}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Загрузка подключений')).toBeInTheDocument()

    rerender(
      <Sidebar
        profiles={[]}
        sessions={[]}
        loading={false}
        onConnect={vi.fn()}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
      />
    )
    expect(screen.getByText('Пока пусто')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('группирует, сортирует и открывает профили', () => {
    const onConnect = vi.fn()
    const onEdit = vi.fn()
    render(
      <Sidebar
        profiles={profiles}
        sessions={[]}
        loading={false}
        onConnect={onConnect}
        onNew={vi.fn()}
        onEdit={onEdit}
        onExport={vi.fn()}
        onImport={vi.fn()}
      />
    )

    expect(screen.getByText('Prod')).toBeInTheDocument()
    expect(screen.getByText('Без группы')).toBeInTheDocument()
    expect(screen.getByText('root@alpha.example')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Открыть сессию Alpha'))
    expect(onConnect).toHaveBeenCalledWith(profiles[0])

    fireEvent.click(screen.getByRole('button', { name: 'Изменить Beta' }))
    expect(onEdit).toHaveBeenCalledWith(profiles[1])
  })

  it('фильтрует профили и показывает отсутствие результатов', () => {
    render(
      <Sidebar
        profiles={profiles}
        sessions={[]}
        loading={false}
        onConnect={vi.fn()}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
      />
    )

    const search = screen.getByLabelText('Поиск подключений')
    fireEvent.change(search, { target: { value: 'beta.example' } })
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'beta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('очищает поиск по Escape и фокусирует по Ctrl+K', () => {
    render(
      <Sidebar
        profiles={profiles}
        sessions={[]}
        loading={false}
        onConnect={vi.fn()}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
      />
    )

    const search = screen.getByLabelText('Поиск подключений')
    fireEvent.change(search, { target: { value: 'alpha' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')

    search.blur()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(search).toHaveFocus()
  })

  it('не перехватывает Ctrl+K при открытом модальном окне', () => {
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.appendChild(modal)

    render(
      <Sidebar
        profiles={profiles}
        sessions={[]}
        loading={false}
        onConnect={vi.fn()}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
      />
    )

    const search = screen.getByLabelText('Поиск подключений')
    search.blur()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(search).not.toHaveFocus()

    modal.remove()
  })

  it('схлопывает группы и показывает активность сессий', () => {
    render(
      <Sidebar
        profiles={profiles}
        sessions={[
          createSession({ id: 's1', profile: profiles[0] }),
          createSession({ id: 's2', profile: profiles[0], status: 'error' })
        ]}
        loading={false}
        onConnect={vi.fn()}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
      />
    )

    expect(document.querySelectorAll('.connection-live-dot')).toHaveLength(1)

    const heading = screen.getByRole('button', { name: /Prod/ })
    expect(heading).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(heading)
    expect(heading).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('вызывает создание, импорт и экспорт', () => {
    const onNew = vi.fn()
    const onImport = vi.fn()
    const onExport = vi.fn()
    render(
      <Sidebar
        profiles={profiles}
        sessions={[]}
        loading={false}
        onConnect={vi.fn()}
        onNew={onNew}
        onEdit={vi.fn()}
        onExport={onExport}
        onImport={onImport}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Новое подключение' }))
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать профили' }))
    fireEvent.click(screen.getByRole('button', { name: 'Экспортировать профили' }))
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledTimes(1)
  })
})
