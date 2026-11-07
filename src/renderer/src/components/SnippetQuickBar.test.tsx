// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SnippetQuickBar } from './SnippetQuickBar'
import { createSnippet } from '../../../test/api'

describe('SnippetQuickBar', () => {
  it('показывает сниппеты и выполняет команду', () => {
    const onRun = vi.fn()
    render(
      <SnippetQuickBar
        snippets={[
          createSnippet({ id: 'one', name: 'Uptime', command: 'uptime', shortcut: 'Ctrl+U' }),
          createSnippet({ id: 'two', name: 'Disk', command: 'df -h', group: 'ops' })
        ]}
        onRun={onRun}
        onManage={vi.fn()}
      />
    )

    expect(screen.getByRole('toolbar', { name: 'Быстрый доступ к сниппетам' })).toBeInTheDocument()
    expect(screen.getByText('Uptime')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+U')).toBeInTheDocument()
    expect(screen.getByText('Disk')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Uptime'))
    expect(onRun).toHaveBeenCalledWith('uptime')
  })

  it('открывает настройку сниппетов', () => {
    const onManage = vi.fn()
    render(<SnippetQuickBar snippets={[]} onRun={vi.fn()} onManage={onManage} />)

    fireEvent.click(screen.getByRole('button', { name: 'Настроить сниппеты' }))
    expect(onManage).toHaveBeenCalledTimes(1)
  })
})
