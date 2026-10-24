import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Loader2,
  LockKeyhole,
  Network,
  Plus,
  Server,
  Trash2,
  Waypoints,
  X,
  Zap
} from 'lucide-react'
import type {
  AuthMethod,
  ConnectionProfile,
  ProfileActionResult,
  ProfileDraft,
  ProxyType,
  TunnelConfig,
  TunnelType
} from '@shared/types'
import { TUNNEL_LABELS } from '@shared/types'
import { avatarGradient, initials, profileSubtitle } from '../utils'

interface ConnectionModalProps {
  profile: ConnectionProfile | null
  profiles: ConnectionProfile[]
  onClose: () => void
  onSave: (id: string | null, draft: ProfileDraft) => Promise<ProfileActionResult>
  onDelete: (profile: ConnectionProfile) => void
  onDuplicate: (profile: ConnectionProfile) => void
}

interface TunnelForm {
  id: string
  type: TunnelType
  name: string
  bindHost: string
  bindPort: string
  destHost: string
  destPort: string
  autoStart: boolean
}

interface FormState {
  name: string
  group: string
  host: string
  port: string
  username: string
  authMethod: AuthMethod
  privateKeyPath: string
  jumpProfileId: string
  password: string
  passphrase: string
  clearPassword: boolean
  clearPassphrase: boolean
  askPassword: boolean
  keepaliveInterval: string
  proxyType: ProxyType
  proxyHost: string
  proxyPort: string
  proxyUsername: string
  proxyPassword: string
  tunnels: TunnelForm[]
}

function tunnelToForm(tunnel: TunnelConfig): TunnelForm {
  return {
    id: tunnel.id,
    type: tunnel.type,
    name: tunnel.name,
    bindHost: tunnel.bindHost,
    bindPort: String(tunnel.bindPort),
    destHost: tunnel.destHost ?? '',
    destPort: tunnel.destPort !== undefined ? String(tunnel.destPort) : '',
    autoStart: tunnel.autoStart
  }
}

function initialForm(profile: ConnectionProfile | null): FormState {
  if (!profile) {
    return {
      name: '',
      group: '',
      host: '',
      port: '22',
      username: '',
      authMethod: 'password',
      privateKeyPath: '',
      jumpProfileId: '',
      password: '',
      passphrase: '',
      clearPassword: false,
      clearPassphrase: false,
      askPassword: false,
      keepaliveInterval: '15000',
      proxyType: 'none',
      proxyHost: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
      tunnels: []
    }
  }
  return {
    name: profile.name,
    group: profile.group,
    host: profile.host,
    port: String(profile.port),
    username: profile.username,
    authMethod: profile.authMethod,
    privateKeyPath: profile.privateKeyPath ?? '',
    jumpProfileId: profile.jumpProfileId ?? '',
    password: '',
    passphrase: '',
    clearPassword: false,
    clearPassphrase: false,
    askPassword: profile.askPassword ?? false,
    keepaliveInterval: String(profile.keepaliveInterval ?? 15000),
    proxyType: profile.proxyType ?? 'none',
    proxyHost: profile.proxyHost ?? '',
    proxyPort: profile.proxyPort !== undefined ? String(profile.proxyPort) : '',
    proxyUsername: profile.proxyUsername ?? '',
    proxyPassword: '',
    tunnels: profile.tunnels.map(tunnelToForm)
  }
}

function newTunnel(): TunnelForm {
  return {
    id: crypto.randomUUID(),
    type: 'local',
    name: '',
    bindHost: '127.0.0.1',
    bindPort: '8080',
    destHost: '127.0.0.1',
    destPort: '80',
    autoStart: true
  }
}

function parsePort(value: string, allowZero: boolean): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const port = Number(value)
  if (!Number.isInteger(port)) return null
  if (port < (allowZero ? 0 : 1) || port > 65535) return null
  return port
}

function validate(form: FormState, profile: ConnectionProfile | null): string | null {
  if (!form.name.trim()) return 'Укажите название подключения'
  if (!form.host.trim()) return 'Укажите адрес сервера'
  if (/\s/.test(form.host.trim())) return 'Адрес сервера не должен содержать пробелы'
  if (!form.username.trim()) return 'Укажите имя пользователя'

  const sshPort = parsePort(form.port, false)
  if (sshPort === null) return 'Порт SSH должен быть от 1 до 65535'

  if (form.authMethod === 'password' && !form.askPassword) {
    const hasSaved = Boolean(profile?.hasPassword) && !form.clearPassword
    if (!form.password && !hasSaved) {
      return 'Введите пароль или включите запрос при подключении'
    }
  }

  if (form.authMethod === 'key' && !form.privateKeyPath.trim()) {
    return 'Укажите путь к приватному ключу'
  }

  const keepalive = Number(form.keepaliveInterval)
  if (!Number.isInteger(keepalive) || keepalive < 1000 || keepalive > 600000) {
    return 'Keep-Alive должен быть от 1000 до 600000 мс'
  }

  if (form.proxyType !== 'none') {
    if (!form.proxyHost.trim()) return 'Укажите хост прокси'
    const pport = Number(form.proxyPort)
    if (!Number.isInteger(pport) || pport < 1 || pport > 65535) {
      return 'Порт прокси должен быть от 1 до 65535'
    }
  }

  const endpoints = new Set<string>()
  for (const [index, tunnel] of form.tunnels.entries()) {
    const label = `Туннель ${index + 1}`
    if (!tunnel.bindHost.trim()) return `${label}: укажите адрес привязки`
    const bindPort = parsePort(tunnel.bindPort, tunnel.type !== 'remote')
    if (bindPort === null) {
      return `${label}: укажите корректный порт${tunnel.type === 'remote' ? '' : ' или 0'}`
    }
    if (tunnel.type !== 'dynamic') {
      if (!tunnel.destHost.trim()) return `${label}: укажите хост назначения`
      const destPort = parsePort(tunnel.destPort, false)
      if (destPort === null) return `${label}: укажите корректный порт назначения`
    }
    if (bindPort !== 0) {
      const key = `${tunnel.type === 'remote' ? 'remote' : 'local'}:${tunnel.bindHost.trim()}:${bindPort}`
      if (endpoints.has(key)) return `${label}: адрес и порт уже используются другим туннелем`
      endpoints.add(key)
    }
  }
  return null
}

function buildDraft(form: FormState): ProfileDraft {
  const tunnels: TunnelConfig[] = form.tunnels.map((tunnel) => ({
    id: tunnel.id,
    name: tunnel.name.trim(),
    type: tunnel.type,
    bindHost: tunnel.bindHost.trim(),
    bindPort: Number(tunnel.bindPort),
    destHost: tunnel.type === 'dynamic' ? undefined : tunnel.destHost.trim(),
    destPort: tunnel.type === 'dynamic' ? undefined : Number(tunnel.destPort),
    autoStart: tunnel.autoStart
  }))

  const hasProxy = form.proxyType !== 'none'

  return {
    name: form.name.trim(),
    group: form.group.trim(),
    host: form.host.trim(),
    port: Number(form.port),
    username: form.username.trim(),
    authMethod: form.authMethod,
    privateKeyPath: form.privateKeyPath.trim() || undefined,
    jumpProfileId: form.jumpProfileId || undefined,
    tunnels,
    askPassword: form.askPassword,
    keepaliveInterval: Number(form.keepaliveInterval) || 15000,
    proxyType: form.proxyType,
    proxyHost: hasProxy ? form.proxyHost.trim() || undefined : undefined,
    proxyPort: hasProxy ? Number(form.proxyPort) || undefined : undefined,
    proxyUsername: hasProxy ? form.proxyUsername.trim() || undefined : undefined,
    proxyPassword: hasProxy ? form.proxyPassword || undefined : undefined,
    password: form.askPassword ? undefined : form.password || undefined,
    passphrase: form.passphrase || undefined,
    clearPassword: form.askPassword ? true : form.clearPassword,
    clearPassphrase: form.clearPassphrase
  }
}

export function ConnectionModal({
  profile,
  profiles,
  onClose,
  onSave,
  onDelete,
  onDuplicate
}: ConnectionModalProps): JSX.Element {
  const [form, setForm] = useState<FormState>(() => initialForm(profile))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showPassphrase, setShowPassphrase] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.confirm-backdrop')) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const groups = useMemo(
    () =>
      Array.from(
        new Set(profiles.map((item) => item.group.trim()).filter((group) => group.length > 0))
      ).sort((first, second) => first.localeCompare(second, 'ru')),
    [profiles]
  )

  const jumpProfiles = useMemo(
    () => profiles.filter((item) => item.id !== profile?.id),
    [profiles, profile?.id]
  )

  const selectedJump = jumpProfiles.find((item) => item.id === form.jumpProfileId)

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]): void => {
    setForm((previous) => ({ ...previous, [key]: value }))
    setError(null)
  }

  const updateTunnel = (id: string, patch: Partial<TunnelForm>): void => {
    setForm((previous) => ({
      ...previous,
      tunnels: previous.tunnels.map((tunnel) =>
        tunnel.id === id ? { ...tunnel, ...patch } : tunnel
      )
    }))
    setError(null)
  }

  const addTunnel = (): void => {
    setForm((previous) => ({ ...previous, tunnels: [...previous.tunnels, newTunnel()] }))
  }

  const removeTunnel = (id: string): void => {
    setForm((previous) => ({
      ...previous,
      tunnels: previous.tunnels.filter((tunnel) => tunnel.id !== id)
    }))
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (saving) return
    const validationError = validate(form, profile)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSaving(true)
    try {
      const result = await onSave(profile?.id ?? null, buildDraft(form))
      if (!result.ok) {
        setError(result.error)
        setSaving(false)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
      setSaving(false)
    }
  }

  const pickKey = async (): Promise<void> => {
    const path = await window.sheller.profiles.pickPrivateKey()
    if (path) {
      update('privateKeyPath', path)
    }
  }

  const passwordSaved = Boolean(profile?.hasPassword) && !form.clearPassword
  const passphraseSaved = Boolean(profile?.hasPassphrase) && !form.clearPassphrase

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="connection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-modal-title"
      >
        <header className="connection-modal-header">
          <div className="connection-modal-title">
            <span
              className="modal-avatar"
              style={{
                background: avatarGradient(form.name || form.host || 'SSH')
              }}
            >
              {initials(form.name || form.host || 'SSH')}
            </span>
            <div>
              <span className="section-kicker">
                {profile ? 'Настройки профиля' : 'Новый профиль'}
              </span>
              <h2 id="connection-modal-title">
                {profile ? profile.name : 'Новое подключение'}
              </h2>
              <p>
                {form.username || 'user'}@{form.host || 'host'}
                {form.port && form.port !== '22' ? `:${form.port}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-icon-button"
            onClick={onClose}
            aria-label="Закрыть"
            disabled={saving}
          >
            <X size={19} />
          </button>
        </header>

        <form className="connection-form" onSubmit={submit} noValidate>
          <div className="connection-modal-body">
            <section className="form-section">
              <div className="form-section-title">
                <span className="form-section-index">01</span>
                <div>
                  <h3>Подключение</h3>
                  <p>Название профиля и адрес SSH-сервера.</p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field field-span-2">
                  <span className="field-label">Название</span>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={(event) => update('name', event.target.value)}
                    placeholder="Например, Production API"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Группа</span>
                  <input
                    value={form.group}
                    onChange={(event) => update('group', event.target.value)}
                    placeholder="Без группы"
                    list="group-options"
                    spellCheck={false}
                  />
                  <datalist id="group-options">
                    {groups.map((group) => (
                      <option key={group} value={group} />
                    ))}
                  </datalist>
                </label>
                <label className="field">
                  <span className="field-label">Пользователь</span>
                  <input
                    value={form.username}
                    onChange={(event) => update('username', event.target.value)}
                    placeholder="root"
                    autoComplete="username"
                    spellCheck={false}
                  />
                </label>
                <label className="field field-span-2">
                  <span className="field-label">Адрес сервера</span>
                  <div className="field-with-suffix">
                    <input
                      value={form.host}
                      onChange={(event) => update('host', event.target.value)}
                      placeholder="server.example.com или 10.0.0.12"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="field-suffix-separator">:</span>
                    <input
                      className="port-input"
                      inputMode="numeric"
                      value={form.port}
                      onChange={(event) =>
                        update('port', event.target.value.replace(/[^\d]/g, ''))
                      }
                      placeholder="22"
                      aria-label="SSH порт"
                    />
                  </div>
                </label>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-title">
                <span className="form-section-index">02</span>
                <div>
                  <h3>Аутентификация</h3>
                  <p>Способ входа и сохранённые учётные данные.</p>
                </div>
              </div>
              <div className="auth-switch" role="group" aria-label="Способ аутентификации">
                {(
                  [
                    ['password', 'Пароль', LockKeyhole],
                    ['key', 'Приватный ключ', KeyRound],
                    ['agent', 'SSH-агент', Waypoints]
                  ] as const
                ).map(([method, label, Icon]) => (
                  <button
                    type="button"
                    key={method}
                    className={`auth-option ${form.authMethod === method ? 'is-active' : ''}`}
                    onClick={() => update('authMethod', method)}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>

              {form.authMethod === 'password' && (
                <div className="auth-fields">
                  {!form.askPassword && (
                    <label className="field">
                      <span className="field-label">Пароль</span>
                      <div className="input-with-action">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={form.password}
                          onChange={(event) => {
                            update('password', event.target.value)
                            if (form.clearPassword) update('clearPassword', false)
                          }}
                          placeholder={
                            passwordSaved
                              ? 'Сохранённый пароль — оставьте пустым'
                              : 'Введите пароль'
                          }
                          autoComplete="new-password"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="input-action"
                          onClick={() => setShowPassword((visible) => !visible)}
                          aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                        >
                          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                      {profile?.hasPassword && (
                        <button
                          type="button"
                          className={`secret-note-button ${
                            form.clearPassword ? 'is-danger' : ''
                          }`}
                          onClick={() => {
                            update('clearPassword', !form.clearPassword)
                            if (!form.clearPassword) update('password', '')
                          }}
                        >
                          {form.clearPassword
                            ? 'Сохранённый пароль будет удалён — отменить'
                            : 'Удалить сохранённый пароль'}
                        </button>
                      )}
                    </label>
                  )}
                  <label className="switch-field" style={{ marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={form.askPassword}
                      onChange={(event) => {
                        const checked = event.target.checked
                        update('askPassword', checked)
                        if (checked) update('password', '')
                      }}
                    />
                    <span className="switch-track">
                      <span className="switch-thumb" />
                    </span>
                    <span className="switch-label">
                      <LockKeyhole size={11} />
                      Спрашивать пароль при подключении
                    </span>
                  </label>
                  <p className="field-hint">
                    {form.askPassword
                      ? 'Пароль не будет сохранён на диск. Он запрашивается каждый раз при подключении. Защищает от доступа при физическом доступе к ПК.'
                      : 'Пароль хранится в зашифрованном виде средствами ОС. Можно включить запрос пароля при подключении.'}
                  </p>
                </div>
              )}

              {form.authMethod === 'key' && (
                <div className="auth-fields">
                  <label className="field">
                    <span className="field-label">Файл приватного ключа</span>
                    <div className="input-with-action">
                      <input
                        value={form.privateKeyPath}
                        onChange={(event) => update('privateKeyPath', event.target.value)}
                        placeholder="C:\Users\you\.ssh\id_ed25519"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="input-action text-action"
                        onClick={pickKey}
                      >
                        <FolderOpen size={15} />
                        Обзор
                      </button>
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Парольная фраза ключа</span>
                    <div className="input-with-action">
                      <input
                        type={showPassphrase ? 'text' : 'password'}
                        value={form.passphrase}
                        onChange={(event) => {
                          update('passphrase', event.target.value)
                          if (form.clearPassphrase) update('clearPassphrase', false)
                        }}
                        placeholder={
                          passphraseSaved
                            ? 'Сохранена — оставьте пустым'
                            : 'Если ключ защищён паролем'
                        }
                        autoComplete="new-password"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="input-action"
                        onClick={() => setShowPassphrase((visible) => !visible)}
                        aria-label={showPassphrase ? 'Скрыть фразу' : 'Показать фразу'}
                      >
                        {showPassphrase ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    {profile?.hasPassphrase && (
                      <button
                        type="button"
                        className={`secret-note-button ${
                          form.clearPassphrase ? 'is-danger' : ''
                        }`}
                        onClick={() => {
                          update('clearPassphrase', !form.clearPassphrase)
                          if (!form.clearPassphrase) update('passphrase', '')
                        }}
                      >
                        {form.clearPassphrase
                          ? 'Сохранённая фраза будет удалена — отменить'
                          : 'Удалить сохранённую парольную фразу'}
                      </button>
                    )}
                  </label>
                  <p className="field-hint">
                    Поддерживаются ключи OpenSSH и PEM. Сам файл ключа не копируется в
                    хранилище приложения.
                  </p>
                </div>
              )}

              {form.authMethod === 'agent' && (
                <div className="info-panel">
                  <span className="info-panel-icon">
                    <Waypoints size={18} />
                  </span>
                  <div>
                    <strong>Системный SSH-агент</strong>
                    <p>
                      Приложение использует <code>SSH_AUTH_SOCK</code> или OpenSSH Agent
                      Windows. Убедитесь, что ключ добавлен в агент через{' '}
                      <code>ssh-add</code>.
                    </p>
                  </div>
                </div>
              )}
            </section>

            <section className="form-section">
              <div className="form-section-title">
                <span className="form-section-index">03</span>
                <div>
                  <h3>Соединение и сеть</h3>
                  <p>Параметры keep-alive и прокси для установки соединения.</p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Keep-Alive (мс)</span>
                  <input
                    inputMode="numeric"
                    value={form.keepaliveInterval}
                    onChange={(event) =>
                      update('keepaliveInterval', event.target.value.replace(/[^\d]/g, ''))
                    }
                    placeholder="15000"
                  />
                  <span className="field-hint">
                    Интервал отправки пакетов для удержания сессии.
                  </span>
                </label>
                <label className="field">
                  <span className="field-label">Прокси</span>
                  <select
                    value={form.proxyType}
                    onChange={(event) => update('proxyType', event.target.value as ProxyType)}
                  >
                    <option value="none">Нет</option>
                    <option value="socks5">SOCKS5</option>
                    <option value="http">HTTP</option>
                  </select>
                </label>
                {form.proxyType !== 'none' && (
                  <>
                    <label className="field">
                      <span className="field-label">Хост прокси</span>
                      <input
                        value={form.proxyHost}
                        onChange={(event) => update('proxyHost', event.target.value)}
                        placeholder="127.0.0.1"
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Порт прокси</span>
                      <input
                        inputMode="numeric"
                        value={form.proxyPort}
                        onChange={(event) =>
                          update('proxyPort', event.target.value.replace(/[^\d]/g, ''))
                        }
                        placeholder="1080"
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Логин (опционально)</span>
                      <input
                        value={form.proxyUsername}
                        onChange={(event) => update('proxyUsername', event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Пароль (опционально)</span>
                      <input
                        type="password"
                        value={form.proxyPassword}
                        onChange={(event) => update('proxyPassword', event.target.value)}
                        autoComplete="new-password"
                        spellCheck={false}
                      />
                    </label>
                  </>
                )}
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-title">
                <span className="form-section-index">04</span>
                <div>
                  <h3>Маршрут</h3>
                  <p>Прямое подключение или через сохранённый jump-хост.</p>
                </div>
              </div>
              <div className="route-box">
                <div className="route-server">
                  <span className="route-icon">
                    <Server size={17} />
                  </span>
                  <div>
                    <strong>Этот компьютер</strong>
                    <span>Sheller</span>
                  </div>
                </div>
                <div className="route-line">
                  {selectedJump ? <Waypoints size={14} /> : <ArrowRight size={14} />}
                </div>
                <div className={`route-server ${selectedJump ? '' : 'is-target'}`}>
                  <span className="route-icon">
                    {selectedJump ? <Waypoints size={17} /> : <Server size={17} />}
                  </span>
                  <div>
                    <strong>{selectedJump ? selectedJump.name : form.host || 'Сервер'}</strong>
                    <span>
                      {selectedJump ? profileSubtitle(selectedJump) : 'прямое SSH'}
                    </span>
                  </div>
                </div>
                {selectedJump && (
                  <>
                    <div className="route-line">
                      <ArrowRight size={14} />
                    </div>
                    <div className="route-server is-target">
                      <span className="route-icon">
                        <Server size={17} />
                      </span>
                      <div>
                        <strong>{form.name || form.host || 'Целевой сервер'}</strong>
                        <span>{form.host || 'host'}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <label className="field">
                <span className="field-label">Jump-хост</span>
                <select
                  value={form.jumpProfileId}
                  onChange={(event) => update('jumpProfileId', event.target.value)}
                >
                  <option value="">Напрямую</option>
                  {jumpProfiles.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} — {profileSubtitle(item)}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Соединение к целевому серверу будет установлено через выбранный профиль.
                </span>
              </label>
            </section>

            <section className="form-section">
              <div className="form-section-title form-section-title-row">
                <div className="form-section-heading">
                  <span className="form-section-index">05</span>
                  <div>
                    <h3>Туннели</h3>
                    <p>Проброс портов и SOCKS5 поверх SSH-сессии.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={addTunnel}
                >
                  <Plus size={14} />
                  Добавить туннель
                </button>
              </div>

              {form.tunnels.length === 0 ? (
                <div className="tunnel-form-empty">
                  <Network size={20} />
                  <div>
                    <strong>Туннели не настроены</strong>
                    <span>
                      Добавьте локальный, удалённый порт или SOCKS5-прокси. Они появятся в
                      панели сессии.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="tunnel-form-list">
                  {form.tunnels.map((tunnel, index) => (
                    <div className="tunnel-form-card" key={tunnel.id}>
                      <div className="tunnel-form-head">
                        <span className="tunnel-index">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="tunnel-type-switch">
                          {(['local', 'remote', 'dynamic'] as const).map((type) => (
                            <button
                              type="button"
                              key={type}
                              className={tunnel.type === type ? 'is-active' : ''}
                              onClick={() => updateTunnel(tunnel.id, { type })}
                            >
                              {TUNNEL_LABELS[type]}
                            </button>
                          ))}
                        </div>
                        <label className="switch-field">
                          <input
                            type="checkbox"
                            checked={tunnel.autoStart}
                            onChange={(event) =>
                              updateTunnel(tunnel.id, { autoStart: event.target.checked })
                            }
                          />
                          <span className="switch-track">
                            <span className="switch-thumb" />
                          </span>
                          <span className="switch-label">
                            <Zap size={11} />
                            авто
                          </span>
                        </label>
                        <button
                          type="button"
                          className="modal-icon-button tunnel-remove"
                          onClick={() => removeTunnel(tunnel.id)}
                          aria-label={`Удалить туннель ${index + 1}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>

                      <div className="form-grid tunnel-form-grid">
                        <label className="field field-span-2">
                          <span className="field-label">Название (необязательно)</span>
                          <input
                            value={tunnel.name}
                            onChange={(event) =>
                              updateTunnel(tunnel.id, { name: event.target.value })
                            }
                            placeholder={`${TUNNEL_LABELS[tunnel.type]} ${tunnel.bindPort || ''}`}
                            spellCheck={false}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">
                            {tunnel.type === 'remote' ? 'Адрес на сервере' : 'Локальный адрес'}
                          </span>
                          <div className="inline-fields">
                            <input
                              value={tunnel.bindHost}
                              onChange={(event) =>
                                updateTunnel(tunnel.id, { bindHost: event.target.value })
                              }
                              placeholder="127.0.0.1"
                              spellCheck={false}
                            />
                            <input
                              className="port-input"
                              inputMode="numeric"
                              value={tunnel.bindPort}
                              onChange={(event) =>
                                updateTunnel(tunnel.id, {
                                  bindPort: event.target.value.replace(/[^\d]/g, '')
                                })
                              }
                              placeholder={tunnel.type === 'remote' ? '8080' : '0'}
                              aria-label="Порт привязки"
                            />
                          </div>
                        </label>
                        {tunnel.type !== 'dynamic' && (
                          <label className="field">
                            <span className="field-label">
                              {tunnel.type === 'remote'
                                ? 'Локальный адрес назначения'
                                : 'Адрес назначения'}
                            </span>
                            <div className="inline-fields">
                              <input
                                value={tunnel.destHost}
                                onChange={(event) =>
                                  updateTunnel(tunnel.id, { destHost: event.target.value })
                                }
                                placeholder="127.0.0.1"
                                spellCheck={false}
                              />
                              <input
                                className="port-input"
                                inputMode="numeric"
                                value={tunnel.destPort}
                                onChange={(event) =>
                                  updateTunnel(tunnel.id, {
                                    destPort: event.target.value.replace(/[^\d]/g, '')
                                  })
                                }
                                placeholder="80"
                                aria-label="Порт назначения"
                              />
                            </div>
                          </label>
                        )}
                      </div>
                      <p className="tunnel-form-hint">
                        {tunnel.type === 'local' &&
                          'Слушает на этом компьютере и передаёт трафик в сеть сервера. Порт 0 выберет свободный порт автоматически.'}
                        {tunnel.type === 'remote' &&
                          'Открывает порт на сервере и передаёт подключения на адрес, доступный с этого компьютера.'}
                        {tunnel.type === 'dynamic' &&
                          'Поднимает локальный SOCKS5-прокси. Укажите его адрес в браузере или приложении.'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <footer className="connection-modal-footer">
            <div className="modal-footer-left">
              {profile && (
                <>
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => onDuplicate(profile)}
                    disabled={saving}
                  >
                    <Copy size={14} />
                    Дублировать
                  </button>
                  <button
                    type="button"
                    className="button button-ghost button-small button-danger-text"
                    onClick={() => onDelete(profile)}
                    disabled={saving}
                  >
                    <Trash2 size={14} />
                    Удалить
                  </button>
                </>
              )}
            </div>
            <div className="modal-footer-right">
              {error && (
                <span className="form-error" role="alert">
                  <AlertCircle size={15} />
                  {error}
                </span>
              )}
              <button
                type="button"
                className="button button-ghost"
                onClick={onClose}
                disabled={saving}
              >
                Отмена
              </button>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? <Loader2 size={15} className="spin" /> : <LockKeyhole size={15} />}
                {saving ? 'Сохранение…' : profile ? 'Сохранить' : 'Создать профиль'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}