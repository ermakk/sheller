// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionModal } from './ConnectionModal'
import { createProfile, createShellerApi, createTunnel, installShellerApi } from '../../../test/api'

function fillRequired(host = 'server.example.com'): void {
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Prod' } })
  fireEvent.change(screen.getByPlaceholderText('server.example.com'), { target: { value: host } })
  fireEvent.change(screen.getByLabelText('Пользователь'), { target: { value: 'root' } })
}

describe('ConnectionModal', () => {
  let api: ReturnType<typeof createShellerApi>

  beforeEach(() => {
    api = createShellerApi()
    installShellerApi(api)
  })

  it('проверяет обязательные поля и создаёт профиль', async () => {
    const onSave = vi.fn(async () => ({ ok: true as const, profile: createProfile() }))
    render(
      <ConnectionModal
        profile={null}
        profiles={[]}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Новое подключение')).toBeInTheDocument()
    expect(screen.getByLabelText('Порт')).toHaveValue('22')

    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите название подключения')

    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Введите пароль')

    fireEvent.change(screen.getByPlaceholderText('Введите пароль'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          name: 'Prod',
          host: 'server.example.com',
          username: 'root',
          port: 22,
          authMethod: 'password',
          password: 'secret',
          askPassword: false,
          keepaliveInterval: 15000,
          proxyType: 'none'
        })
      )
    )
  })

  it('переключает протокол и режим запроса пароля', async () => {
    const onSave = vi.fn(async () => ({ ok: true as const, profile: createProfile() }))
    render(
      <ConnectionModal
        profile={null}
        profiles={[]}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Протокол'), { target: { value: 'telnet' } })
    expect(screen.getByLabelText('Порт')).toHaveValue('23')
    expect(screen.queryByText('Аутентификация')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Протокол'), { target: { value: 'mosh' } })
    expect(screen.getByLabelText('Порт')).toHaveValue('22')
    expect(screen.getByText(/Mosh использует SSH/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Mosh-клиент/)).toBeInTheDocument()

    fillRequired()
    fireEvent.click(screen.getByLabelText('Спрашивать пароль при подключении'))
    expect(screen.queryByPlaceholderText('Введите пароль')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ askPassword: true, password: undefined, clearPassword: true })
      )
    )
  })

  it('выбирает приватный ключ через диалог', async () => {
    api.profiles.pickPrivateKey = vi.fn(async () => 'C:\\keys\\id_ed25519')
    const onSave = vi.fn(async () => ({ ok: true as const, profile: createProfile() }))
    render(
      <ConnectionModal
        profile={null}
        profiles={[]}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: /Приватный ключ/ }))
    fireEvent.click(screen.getByRole('button', { name: /Обзор/ }))

    await waitFor(() =>
      expect(screen.getByPlaceholderText('C:\\Users\\you\\.ssh\\id_ed25519')).toHaveValue(
        'C:\\keys\\id_ed25519'
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ authMethod: 'key', privateKeyPath: 'C:\\keys\\id_ed25519' })
      )
    )
  })

  it('валидирует keep-alive, прокси и туннели', () => {
    const { container } = render(
      <ConnectionModal
        profile={null}
        profiles={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => ({ ok: true as const }))}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    fillRequired()
    fireEvent.change(screen.getByPlaceholderText('Введите пароль'), { target: { value: 'secret' } })

    fireEvent.change(screen.getByLabelText('Keep-Alive (мс)'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Keep-Alive должен быть от 1000 до 600000 мс')

    fireEvent.change(screen.getByLabelText('Keep-Alive (мс)'), { target: { value: '15000' } })
    fireEvent.change(screen.getByLabelText('Прокси'), { target: { value: 'socks5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите хост прокси')

    fireEvent.change(screen.getByLabelText('Хост прокси'), { target: { value: '127.0.0.1' } })
    fireEvent.change(screen.getByLabelText('Порт прокси'), { target: { value: '1080' } })
    fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }))
    expect(screen.getByText('Локальный')).toBeInTheDocument()
    const tunnelBindHost = container.querySelector(
      '.tunnel-form-card input[placeholder="127.0.0.1"]'
    ) as HTMLInputElement
    fireEvent.change(tunnelBindHost, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Туннель 1: укажите адрес привязки')
  })

  it('сохраняет прокси и туннель', async () => {
    const onSave = vi.fn(async () => ({ ok: true as const, profile: createProfile() }))
    render(
      <ConnectionModal
        profile={null}
        profiles={[]}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    fillRequired()
    fireEvent.change(screen.getByPlaceholderText('Введите пароль'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('Прокси'), { target: { value: 'http' } })
    fireEvent.change(screen.getByLabelText('Хост прокси'), { target: { value: 'proxy.local' } })
    fireEvent.change(screen.getByLabelText('Порт прокси'), { target: { value: '3128' } })
    fireEvent.change(screen.getByLabelText('Пользователь прокси'), { target: { value: 'proxy' } })
    fireEvent.change(screen.getByPlaceholderText('Сохранённый — оставьте пустым'), {
      target: { value: 'proxy-pass' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }))

    const tunnelName = screen.getByPlaceholderText('Например, Web')
    fireEvent.change(tunnelName, { target: { value: 'Web' } })
    fireEvent.change(screen.getByLabelText(/Привязка к интерфейсу VPN/), {
      target: { value: '10.8.0.2' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          proxyType: 'http',
          proxyHost: 'proxy.local',
          proxyPort: 3128,
          proxyUsername: 'proxy',
          proxyPassword: 'proxy-pass',
          bindAddress: '10.8.0.2',
          tunnels: [
            expect.objectContaining({
              name: 'Web',
              type: 'local',
              bindHost: '127.0.0.1',
              bindPort: 8080,
              destHost: '127.0.0.1',
              destPort: 80,
              autoStart: true
            })
          ]
        })
      )
    )
  })

  it('не допускает одинаковые туннели и поддерживает dynamic', () => {
    const { container } = render(
      <ConnectionModal
        profile={null}
        profiles={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => ({ ok: true as const }))}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    fillRequired()
    fireEvent.change(screen.getByPlaceholderText('Введите пароль'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(screen.getByRole('alert')).toHaveTextContent('адрес и порт уже используются')

    fireEvent.click(container.querySelectorAll('.tunnel-remove')[0])
    fireEvent.click(container.querySelector('.tunnel-remove') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'SOCKS5' }))
    expect(screen.queryByText('Назначение')).not.toBeInTheDocument()
  })

  it('редактирует профиль, удаляет секреты и вызывает действия', async () => {
    const profile = createProfile({
      id: 'edit',
      name: 'Prod',
      hasPassword: true,
      hasPassphrase: true,
      tunnels: [createTunnel()]
    })
    const jump = createProfile({ id: 'jump', name: 'Bastion', host: 'bastion.local' })
    const onSave = vi.fn(async () => ({ ok: true as const, profile }))
    const onDelete = vi.fn()
    const onDuplicate = vi.fn()

    render(
      <ConnectionModal
        profile={profile}
        profiles={[profile, jump]}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
      />
    )

    expect(screen.getByText('Настройки профиля')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Сохранённый пароль — оставьте пустым')).toBeInTheDocument()
    const jumpSelect = screen.getByLabelText('Jump-хост')
    expect(jumpSelect).not.toHaveTextContent('Prod')
    expect(jumpSelect).toHaveTextContent('Bastion')

    fireEvent.click(screen.getByRole('button', { name: /Удалить сохранённый пароль/ }))
    const cancelClear = screen.getByRole('button', { name: /Сохранённый пароль будет удалён/ })
    expect(cancelClear).toBeInTheDocument()
    fireEvent.click(cancelClear)
    expect(screen.getByRole('button', { name: /Удалить сохранённый пароль/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Дублировать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDuplicate).toHaveBeenCalledWith(profile)
    expect(onDelete).toHaveBeenCalledWith(profile)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'edit',
        expect.objectContaining({ clearPassword: false, password: undefined })
      )
    )
  })

  it('показывает ошибку сохранения и исключение', async () => {
    const onSave = vi.fn(async () => ({ ok: false, error: 'Диск переполнен' }))
    const { rerender } = render(
      <ConnectionModal
        profile={createProfile({ hasPassword: true })}
        profiles={[]}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Диск переполнен')).toBeInTheDocument()

    onSave.mockRejectedValueOnce(new Error('Сеть недоступна'))
    rerender(
      <ConnectionModal
        profile={createProfile({ hasPassword: true })}
        profiles={[]}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Сеть недоступна')).toBeInTheDocument()
  })

  it('показывает пароль и закрывает окно', () => {
    const onClose = vi.fn()
    render(
      <ConnectionModal
        profile={null}
        profiles={[]}
        onClose={onClose}
        onSave={vi.fn(async () => ({ ok: true as const }))}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    const password = screen.getByPlaceholderText('Введите пароль')
    expect(password).toHaveAttribute('type', 'password')
    fireEvent.click(password.parentElement?.querySelector('.input-action') as HTMLElement)
    expect(password).toHaveAttribute('type', 'text')

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('не закрывается по Escape при открытом подтверждении', () => {
    const onClose = vi.fn()
    const dialog = document.createElement('div')
    dialog.className = 'confirm-backdrop'
    document.body.appendChild(dialog)

    render(
      <ConnectionModal
        profile={null}
        profiles={[]}
        onClose={onClose}
        onSave={vi.fn(async () => ({ ok: true as const }))}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    dialog.remove()
  })
})
