import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Check, ChevronDown, ChevronRight, ClipboardPaste, Loader2, Pencil, Pin,
  Plus, Terminal, Trash2, X
} from 'lucide-react'
import type { Snippet } from '@shared/types'
import { isReservedShortcut, normalizeShortcut, shortcutFromEvent } from '@shared/shortcuts'
import { errorMessage } from '../utils'

interface SnippetsPanelProps {
  snippets: Snippet[]
  onClose: () => void
  onPaste: (command: string) => void
  onSnippetsChange: (snippets: Snippet[]) => void
}

export function SnippetsPanel({ snippets, onClose, onPaste, onSnippetsChange }: SnippetsPanelProps): JSX.Element {
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [command, setCommand] = useState('')
  const [shortcut, setShortcut] = useState('')
  const [quickAccess, setQuickAccess] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const resetForm = (keepGroup = false): void => {
    setEditingId(null)
    setName('')
    setCommand('')
    setShortcut('')
    setQuickAccess(false)
    setError(null)
    setSaving(false)
    if (!keepGroup) setGroup('')
  }

  useEffect(() => {
    if (editingId && !snippets.some((snippet) => snippet.id === editingId)) resetForm()
  }, [snippets, editingId])

  const refresh = async (): Promise<void> => {
    onSnippetsChange(await window.sheller.snippets.list())
  }

  const startEdit = (snippet: Snippet): void => {
    setEditingId(snippet.id)
    setName(snippet.name)
    setGroup(snippet.group ?? '')
    setCommand(snippet.command)
    setShortcut(snippet.shortcut ?? '')
    setQuickAccess(Boolean(snippet.quickAccess))
    setError(null)
  }

  const handleSave = async (): Promise<void> => {
    if (!name.trim() || !command.trim()) return

    const rawShortcut = shortcut.trim()
    const normalizedShortcut = rawShortcut ? normalizeShortcut(rawShortcut) : null
    if (rawShortcut && !normalizedShortcut) {
      setError('Некорректное сочетание клавиш')
      return
    }
    if (normalizedShortcut && isReservedShortcut(normalizedShortcut)) {
      setError('Это сочетание зарезервировано терминалом')
      return
    }

    const duplicate = normalizedShortcut
      ? snippets.find((snippet) => snippet.id !== editingId && snippet.shortcut === normalizedShortcut)
      : undefined
    if (duplicate) {
      setError(`Сочетание ${normalizedShortcut} уже назначено сниппету «${duplicate.name}»`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await window.sheller.snippets.save({
        id: editingId ?? undefined,
        name: name.trim(),
        command,
        group: group.trim(),
        shortcut: normalizedShortcut ?? undefined,
        quickAccess
      })
      if (!result.ok) {
        setError(result.error ?? 'Не удалось сохранить сниппет')
        return
      }
      await refresh()
      if (editingId) resetForm()
      else {
        setName('')
        setCommand('')
        setShortcut('')
        setQuickAccess(false)
      }
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    setError(null)
    try {
      const result = await window.sheller.snippets.remove(id)
      if (!result.ok) {
        setError(result.error ?? 'Не удалось удалить сниппет')
        return
      }
      await refresh()
      if (editingId === id) resetForm()
    } catch (deleteError) {
      setError(errorMessage(deleteError))
    }
  }

  const toggleQuickAccess = async (snippet: Snippet): Promise<void> => {
    setError(null)
    try {
      const result = await window.sheller.snippets.save({
        id: snippet.id,
        name: snippet.name,
        command: snippet.command,
        group: snippet.group,
        shortcut: snippet.shortcut,
        quickAccess: !snippet.quickAccess
      })
      if (!result.ok) {
        setError(result.error ?? 'Не удалось обновить сниппет')
        return
      }
      await refresh()
    } catch (toggleError) {
      setError(errorMessage(toggleError))
    }
  }

  const toggleGroup = (groupName: string): void => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  const groupedSnippets = useMemo(() => {
    const map = new Map<string, Snippet[]>()
    for (const snippet of snippets) {
      const groupName = snippet.group?.trim() || 'Без группы'
      const list = map.get(groupName) ?? []
      list.push(snippet)
      map.set(groupName, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Без группы') return 1
      if (b === 'Без группы') return -1
      return a.localeCompare(b, 'ru')
    })
  }, [snippets])

  return (
    <div className="sftp-panel" style={{ width: 340 }}>
      <header className="sftp-header">
        <span>Сниппеты (Команды)</span>
        <button type="button" className="modal-icon-button" onClick={onClose} aria-label="Закрыть"><X size={16} /></button>
      </header>

      <div className="sftp-list" style={{ flex: 1 }}>
        {groupedSnippets.map(([groupName, items]) => {
          const isCollapsed = collapsed.has(groupName)
          return (
            <div key={groupName} className="snippet-group">
              <button
                type="button"
                className="connection-group-heading snippet-group-heading"
                onClick={() => toggleGroup(groupName)}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span>{groupName}</span>
                <span className="group-count">{items.length}</span>
              </button>

              {!isCollapsed && items.map((snippet) => (
                <div key={snippet.id} className={`snippet-item ${editingId === snippet.id ? 'is-editing' : ''}`}>
                  <div className="snippet-item-row">
                    <Terminal size={14} className="snippet-item-icon" />
                    <strong className="snippet-item-name">{snippet.name}</strong>
                    <div className="snippet-item-actions">
                      <button
                        type="button"
                        className={`snippet-action ${snippet.quickAccess ? 'is-active' : ''}`}
                        onClick={() => void toggleQuickAccess(snippet)}
                        title={snippet.quickAccess ? 'Убрать из быстрого доступа' : 'Добавить в быстрый доступ'}
                        aria-label={snippet.quickAccess ? 'Убрать из быстрого доступа' : 'Добавить в быстрый доступ'}
                      >
                        <Pin size={13} fill={snippet.quickAccess ? 'currentColor' : 'none'} />
                      </button>
                      <button type="button" className="snippet-action" onClick={() => startEdit(snippet)} title="Редактировать" aria-label="Редактировать">
                        <Pencil size={13} />
                      </button>
                      <button type="button" className="snippet-action snippet-action-accent" onClick={() => onPaste(snippet.command)} title="Вставить в терминал" aria-label="Вставить в терминал">
                        <ClipboardPaste size={13} />
                      </button>
                      <button type="button" className="snippet-action snippet-action-danger" onClick={() => void handleDelete(snippet.id)} title="Удалить" aria-label="Удалить">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="snippet-item-meta">
                    <code>{snippet.command}</code>
                    {snippet.shortcut && <kbd className="snippet-shortcut-badge">{snippet.shortcut}</kbd>}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
        {snippets.length === 0 && <div className="file-browser-empty">Нет сохранённых команд</div>}
      </div>

      <div className="snippet-form">
        {editingId && (
          <div className="snippet-form-title"><Pencil size={12} />Редактирование сниппета</div>
        )}
        <div className="snippet-form-row">
          <input className="snippet-input" placeholder="Название" value={name} onChange={(event) => setName(event.target.value)} />
          <input className="snippet-input" placeholder="Группа" value={group} onChange={(event) => setGroup(event.target.value)} />
        </div>
        <textarea
          className="snippet-input snippet-textarea"
          rows={2}
          placeholder="Команда"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
        <div className="snippet-form-row snippet-form-row-options">
          <ShortcutCapture value={shortcut} onChange={setShortcut} onError={setError} />
          <label className="snippet-quick-toggle">
            <input type="checkbox" checked={quickAccess} onChange={(event) => setQuickAccess(event.target.checked)} />
            <Pin size={12} fill={quickAccess ? 'currentColor' : 'none'} />
            <span>Быстрый доступ</span>
          </label>
        </div>
        {error && <div className="snippet-form-error" role="alert">{error}</div>}
        <div className="snippet-form-actions">
          {editingId && (
            <button type="button" className="button button-ghost button-small" onClick={() => resetForm()} disabled={saving}>
              Отмена
            </button>
          )}
          <button
            type="button"
            className="button button-primary button-small snippet-save-button"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim() || !command.trim()}
          >
            {saving ? <Loader2 size={14} className="spin" /> : editingId ? <Check size={14} /> : <Plus size={14} />}
            {editingId ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ShortcutCaptureProps {
  value: string
  onChange: (value: string) => void
  onError: (message: string | null) => void
}

function ShortcutCapture({ value, onChange, onError }: ShortcutCaptureProps): JSX.Element {
  const [recording, setRecording] = useState(false)

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setRecording(false)
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      onChange('')
      onError(null)
      setRecording(false)
      event.currentTarget.blur()
      return
    }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return

    const next = shortcutFromEvent(event.nativeEvent)
    if (!next) {
      onError('Добавьте Ctrl, Alt или Cmd к сочетанию')
      return
    }
    if (isReservedShortcut(next)) {
      onError('Это сочетание зарезервировано терминалом')
      return
    }

    onChange(next)
    onError(null)
    setRecording(false)
    event.currentTarget.blur()
  }

  return (
    <div className={`snippet-shortcut-field ${recording ? 'is-recording' : ''}`}>
      <input
        className="snippet-input"
        readOnly
        value={recording ? '' : value}
        placeholder={recording ? 'Нажмите сочетание…' : 'Сочетание клавиш'}
        onFocus={() => { setRecording(true); onError(null) }}
        onBlur={() => setRecording(false)}
        onKeyDown={handleKeyDown}
        aria-label="Сочетание клавиш для сниппета"
      />
      {value && !recording && (
        <button
          type="button"
          className="snippet-shortcut-clear"
          onClick={() => { onChange(''); onError(null) }}
          title="Очистить сочетание"
          aria-label="Очистить сочетание"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
