import { useState, useEffect, useMemo } from 'react'
import { ClipboardPaste, Plus, Trash2, Terminal, X, ChevronDown, ChevronRight } from 'lucide-react'
import type { Snippet } from '@shared/types'

interface SnippetsPanelProps {
  onClose: () => void
  onPaste: (command: string) => void
}

export function SnippetsPanel({ onClose, onPaste }: SnippetsPanelProps): JSX.Element {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [command, setCommand] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const load = async () => {
    const list = await window.sheller.snippets.list()
    setSnippets(list)
  }

  useEffect(() => { void load() }, [])

  const handleSave = async () => {
    if (!name.trim() || !command.trim()) return
    await window.sheller.snippets.save({ name, command, group })
    setName('')
    setCommand('')
    // Группу не сбрасываем, чтобы можно было быстро добавить несколько команд в одну группу
    void load()
  }

  const handleDelete = async (id: string) => {
    await window.sheller.snippets.remove(id)
    void load()
  }

  const toggleGroup = (name: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Группировка сниппетов
  const groupedSnippets = useMemo(() => {
    const map = new Map<string, Snippet[]>()
    for (const s of snippets) {
      const g = s.group?.trim() || 'Без группы'
      const list = map.get(g) ?? []
      list.push(s)
      map.set(g, list)
    }
    // Сортируем группы, "Без группы" в конец
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Без группы') return 1
      if (b === 'Без группы') return -1
      return a.localeCompare(b, 'ru')
    })
  }, [snippets])

  return (
    <div className="sftp-panel" style={{ width: 320 }}>
      <header className="sftp-header">
        <span>Сниппеты (Команды)</span>
        <button className="modal-icon-button" onClick={onClose}><X size={16} /></button>
      </header>
      
      <div className="sftp-list" style={{ flex: 1 }}>
        {groupedSnippets.map(([groupName, items]) => {
          const isCollapsed = collapsed.has(groupName)
          return (
            <div key={groupName} style={{ marginBottom: 4 }}>
              <button
                type="button"
                className="connection-group-heading"
                onClick={() => toggleGroup(groupName)}
                style={{ padding: '6px 8px', width: '100%' }}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--faint)' }}>{groupName}</span>
                <span className="group-count" style={{ marginLeft: 'auto' }}>{items.length}</span>
              </button>
              
              {!isCollapsed && items.map(s => (
                <div key={s.id} className="sftp-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4, paddingLeft: 16 }}>
                  <div style={{ display: 'flex', width: '100%', alignItems: 'center' }}>
                    <Terminal size={14} style={{ marginRight: 6, color: 'var(--accent)' }} />
                    <strong style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</strong>
                    <button onClick={() => onPaste(s.command)} title="Вставить в терминал" style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', marginRight: 8 }}>
                      <ClipboardPaste size={14} />
                    </button>
                    <button onClick={() => handleDelete(s.id)} title="Удалить" style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <code style={{ fontSize: 10, color: 'var(--faint)', wordBreak: 'break-all', paddingLeft: 20 }}>{s.command}</code>
                </div>
              ))}
            </div>
          )
        })}
        {snippets.length === 0 && <div className="file-browser-empty">Нет сохранённых команд</div>}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="field" style={{ flex: 1, background: 'var(--bg)', padding: 6, borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text)' }} placeholder="Название" value={name} onChange={e => setName(e.target.value)} />
          <input className="field" style={{ flex: 1, background: 'var(--bg)', padding: 6, borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text)' }} placeholder="Группа" value={group} onChange={e => setGroup(e.target.value)} />
        </div>
        <textarea className="field" style={{ background: 'var(--bg)', padding: 6, borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text)', resize: 'none' }} rows={2} placeholder="Команда" value={command} onChange={e => setCommand(e.target.value)} />
        <button className="button button-primary button-small" style={{ width: '100%' }} onClick={handleSave} disabled={!name || !command}>
          <Plus size={14} /> Добавить
        </button>
      </div>
    </div>
  )
}