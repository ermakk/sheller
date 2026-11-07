// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CronModal } from './CronModal'
import { createShellerApi, installShellerApi } from '../../../test/api'
import type { CronJob } from '@shared/types'

const job = (overrides: Partial<CronJob> = {}): CronJob => ({
  id: 'job-1',
  schedule: '*/5 * * * *',
  command: 'echo hi',
  ...overrides
})

describe('CronModal', () => {
  let api: ReturnType<typeof createShellerApi>

  beforeEach(() => {
    api = createShellerApi()
    installShellerApi(api)
  })

  it('загружает существующие задачи', async () => {
    api.sessions.cronList = vi.fn(async () => [job()])
    render(<CronModal sessionId="session-1" onClose={vi.fn()} />)

    expect(await screen.findByText('echo hi')).toBeInTheDocument()
    expect(screen.getByText('*/5 * * * *')).toBeInTheDocument()
    expect(api.sessions.cronList).toHaveBeenCalledWith('session-1')
  })

  it('показывает пустое состояние', async () => {
    render(<CronModal sessionId="session-1" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Нет активных задач')).toBeInTheDocument())
  })

  it('добавляет задачу с расписанием и очищает форму', async () => {
    api.sessions.cronList = vi.fn(async () => [])
    api.sessions.cronSave = vi.fn(async () => ({ ok: true }))
    render(<CronModal sessionId="session-1" onClose={vi.fn()} />)
    await waitFor(() => expect(api.sessions.cronList).toHaveBeenCalled())

    fireEvent.change(screen.getByPlaceholderText("echo 'hi'"), { target: { value: 'df -h' } })
    fireEvent.click(screen.getByRole('button', { name: 'Каждый час' }))
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() =>
      expect(api.sessions.cronSave).toHaveBeenCalledWith('session-1', [
        expect.objectContaining({ schedule: '0 * * * *', command: 'df -h' })
      ])
    )
    expect(screen.getByText('df -h')).toBeInTheDocument()
    expect(screen.getByPlaceholderText("echo 'hi'")).toHaveValue('')
  })

  it('удаляет задачу', async () => {
    const existing = job()
    api.sessions.cronList = vi.fn(async () => [existing])
    api.sessions.cronSave = vi.fn(async () => ({ ok: true }))
    render(<CronModal sessionId="session-1" onClose={vi.fn()} />)
    await screen.findByText('echo hi')

    fireEvent.click(screen.getByTitle('Удалить задачу'))
    await waitFor(() => expect(api.sessions.cronSave).toHaveBeenCalledWith('session-1', []))
    expect(screen.getByText('Нет активных задач')).toBeInTheDocument()
  })

  it('обновляет crontab по кнопке', async () => {
    api.sessions.cronList = vi.fn(async () => [])
    render(<CronModal sessionId="session-1" onClose={vi.fn()} />)
    await waitFor(() => expect(api.sessions.cronList).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTitle('Обновить'))
    await waitFor(() => expect(api.sessions.cronList).toHaveBeenCalledTimes(2))
  })

  it('показывает ошибки загрузки и сохранения', async () => {
    api.sessions.cronList = vi.fn(async () => {
      throw new Error('нет доступа')
    })
    const { rerender } = render(<CronModal sessionId="session-1" onClose={vi.fn()} />)
    expect(await screen.findByText('нет доступа')).toBeInTheDocument()

    api.sessions.cronList = vi.fn(async () => [])
    api.sessions.cronSave = vi.fn(async () => ({ ok: false, error: 'crontab недоступен' }))
    rerender(<CronModal sessionId="session-2" onClose={vi.fn()} />)
    await waitFor(() => expect(api.sessions.cronList).toHaveBeenCalledWith('session-2'))

    fireEvent.change(screen.getByPlaceholderText("echo 'hi'"), { target: { value: 'ls' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByText('crontab недоступен')).toBeInTheDocument()

    api.sessions.cronSave = vi.fn(async () => {
      throw new Error('disk full')
    })
    fireEvent.change(screen.getByPlaceholderText("echo 'hi'"), { target: { value: 'pwd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByText('disk full')).toBeInTheDocument()
  })

  it('закрывается по кнопке и фону', async () => {
    api.sessions.cronList = vi.fn(async () => [])
    const onClose = vi.fn()
    render(<CronModal sessionId="session-1" onClose={onClose} />)
    await waitFor(() => expect(api.sessions.cronList).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
