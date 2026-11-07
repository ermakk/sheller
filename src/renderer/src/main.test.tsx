// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  function AppMock(): null {
    return null
  }
  function DetachedAppMock(): null {
    return null
  }
  return {
    render: vi.fn(),
    createRoot: vi.fn(),
    AppMock,
    DetachedAppMock
  }
})

vi.mock('react-dom/client', () => ({
  default: { createRoot: mocks.createRoot }
}))
vi.mock('./App', () => ({ default: mocks.AppMock }))
vi.mock('./DetachedApp', () => ({ default: mocks.DetachedAppMock }))

describe('main', () => {
  beforeEach(() => {
    mocks.render.mockReset()
    mocks.createRoot.mockReset()
    mocks.createRoot.mockReturnValue({ render: mocks.render })
    vi.resetModules()

    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
  })

  afterEach(() => {
    document.getElementById('root')?.remove()
    window.history.replaceState({}, '', '/')
  })

  it('монтирует основное приложение', async () => {
    window.history.replaceState({}, '', '/')

    await import('./main')

    expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById('root'))
    const element = mocks.render.mock.calls[0][0]
    expect(element.type).toBe(mocks.AppMock)
  })

  it('монтирует откреплённое окно при наличии параметров', async () => {
    window.history.replaceState({}, '', '/?detached=session-1&profileId=profile-1')

    await import('./main')

    const element = mocks.render.mock.calls[0][0]
    expect(element.type).toBe(mocks.DetachedAppMock)
    expect(element.props).toEqual({ sessionId: 'session-1', profileId: 'profile-1' })
  })

  it('без profileId показывает основное приложение', async () => {
    window.history.replaceState({}, '', '/?detached=session-1')

    await import('./main')

    const element = mocks.render.mock.calls[0][0]
    expect(element.type).toBe(mocks.AppMock)
  })
})
