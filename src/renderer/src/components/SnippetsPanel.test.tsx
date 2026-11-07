// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SnippetsPanel } from './SnippetsPanel'
import { createShellerApi, createSnippet, installShellerApi } from '../../../test/api'
import type { Snippet } from '@shared/types'

describe('SnippetsPanel', () => {
  let api: ReturnType<typeof createShellerApi>

  beforeEach(() => {
    api = createShellerApi()
    installShellerApi(api)
  })

  it('группирует сниппеты и вставляет команду', () => {
    const onPaste = vi.fn()
    render(
      <SnippetsPanel
        snippets={[
          createSnippet({ id: 'one', name: 'Uptime', command: 'uptime', group: 'ops' }),
          createSnippet({ id: 'two', name: 'Disk', command: 'df -h', group: 'ops' }),
          createSnippet({ id: 'three', name: 'Pwd', command: 'pwd', group: '' })
        ]}
        onClose={vi.fn()}
        onPaste={onPaste}
        onSnippetsChange={vi.fn()}
      />
    )

    expect(screen.getByText('ops')).toBeInTheDocument()
    expect(screen.getByText('Без группы')).toBeInTheDocument()
    expect(screen.getByText('uptime')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Вставить в терминал' })[0])
    expect(onPaste).toHaveBeenCalledWith('uptime')
  })

  it('схлопывает группы и показывает пустое состояние', () => {
    const { rerender } = render(
      <SnippetsPanel
        snippets={[createSnippet({ group: 'ops' })]}
        onClose={vi.fn()}
        onPaste={vi.fn()}
        onSnippetsChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /ops/ }))
    expect(screen.queryByText('Uptime')).not.toBeInTheDocument()

    rerender(<SnippetsPanel snippets={[]} onClose={vi.fn()} onPaste={vi.fn()} onSnippetsChange={vi.fn()} />)
    expect(screen.getByText('Нет сохранённых команд')).toBeInTheDocument()
  })

  it('создаёт сниппет и обновляет список', async () => {
    const saved = createSnippet({ id: 'new', name: 'Disk', command: 'df -h', group: 'ops' })
    api.snippets.list = vi.fn(async () => [saved])
    const onSnippetsChange = vi.fn()

    render(<SnippetsPanel snippets={[]} onClose={vi.fn()} onPaste={vi.fn()} onSnippetsChange={onSnippetsChange} />)
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Название'), { target: { value: 'Disk' } })
    fireEvent.change(screen.getByPlaceholderText('Команда'), { target: { value: 'df -h' } })
    fireEvent.change(screen.getByPlaceholderText('Группа'), { target: { value: 'ops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() =>
      expect(api.snippets.save).toHaveBeenCalledWith({
        id: undefined,
        name: 'Disk',
        command: 'df -h',
        group: 'ops',
        shortcut: undefined,
        quickAccess: false
      })
    )
    expect(onSnippetsChange).toHaveBeenCalledWith([saved])
    expect(screen.getByPlaceholderText('Название')).toHaveValue('')
  })

  it('редактирует существующий сниппет', async () => {
    const snippet = createSnippet({ id: 'one', name: 'Uptime', command: 'uptime', group: 'ops' })
    api.snippets.list = vi.fn(async () => [snippet])
    const onSnippetsChange = vi.fn()

    render(
      <SnippetsPanel snippets={[snippet]} onClose={vi.fn()} onPaste={vi.fn()} onSnippetsChange={onSnippetsChange} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
    expect(screen.getByText('Редактирование сниппета')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Название')).toHaveValue('Uptime')

    fireEvent.change(screen.getByPlaceholderText('Название'), { target: { value: 'Ping' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(api.snippets.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'one', name: 'Ping', command: 'uptime' })
      )
    )
    expect(onSnippetsChange).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Редактирование сниппета')).not.toBeInTheDocument())
  })

  it('переключает быстрый доступ и удаляет сниппет', async () => {
    const snippet = createSnippet({ id: 'one', name: 'Uptime', command: 'uptime' })
    api.snippets.list = vi.fn(async () => [snippet])
    const onSnippetsChange = vi.fn()

    render(
      <SnippetsPanel snippets={[snippet]} onClose={vi.fn()} onPaste={vi.fn()} onSnippetsChange={onSnippetsChange} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Добавить в быстрый доступ' }))
    await waitFor(() =>
      expect(api.snippets.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'one', quickAccess: true })
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(api.snippets.remove).toHaveBeenCalledWith('one'))
    expect(onSnippetsChange).toHaveBeenCalled()
  })

  it('показывает ошибки сохранения, удаления и быстрого доступа', async () => {
    const snippet = createSnippet({ id: 'one' })
    const { rerender } = render(
      <SnippetsPanel snippets={[snippet]} onClose={vi.fn()} onPaste={vi.fn()} onSnippetsChange={vi.fn()} />
    )

    api.snippets.save = vi.fn(async () => ({ ok: false, error: 'нет места' }))
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('нет места')).toBeInTheDocument()

    api.snippets.remove = vi.fn(async () => ({ ok: false, error: 'занято' }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(await screen.findByText('занято')).toBeInTheDocument()

    api.snippets.save = vi.fn(async () => {
      throw new Error('сбой')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в быстрый доступ' }))
    expect(await screen.findByText('сбой')).toBeInTheDocument()

    rerender(<SnippetsPanel snippets={[]} onClose={vi.fn()} onPaste={vi.fn()} onSnippetsChange={vi.fn()} />)
    expect(screen.queryByText('Редактирование сниппета')).not.toBeInTheDocument()
  })

  it('проверяет сочетание клавиш и дубликаты', async () => {
    const snippet = createSnippet({ id: 'one', name: 'Uptime', command: 'uptime', shortcut: 'Ctrl+Shift+U' })
    render(
      <SnippetsPanel snippets={[snippet]} onClose={vi.fn()} onPaste={vi.fn()} onSnippetsChange={vi.fn()} />
    )

    fireEvent.change(screen.getByPlaceholderText('Название'), { target: { value: 'New' } })
    fireEvent.change(screen.getByPlaceholderText('Команда'), { target: { value: 'pwd' } })

    const shortcut = screen.getByLabelText('Сочетание клавиш для сниппета')
    fireEvent.focus(shortcut)
    fireEvent.keyDown(shortcut, { key: 'K' })
    expect(screen.getByText('Добавьте Ctrl, Alt или Cmd к сочетанию')).toBeInTheDocument()

    fireEvent.keyDown(shortcut, { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true })
    expect(shortcut).toHaveValue('Ctrl+Shift+U')

    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByText(/уже назначено/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Очистить сочетание' }))
    expect(screen.queryByRole('button', { name: 'Очистить сочетание' })).not.toBeInTheDocument()
  })
})
