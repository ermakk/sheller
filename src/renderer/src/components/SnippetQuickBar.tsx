import { Pin, Settings2, Terminal } from 'lucide-react'
import type { Snippet } from '@shared/types'

interface SnippetQuickBarProps {
  snippets: Snippet[]
  onRun: (command: string) => void
  onManage: () => void
}

export function SnippetQuickBar({ snippets, onRun, onManage }: SnippetQuickBarProps): JSX.Element {
  return (
    <div className="snippet-quickbar" role="toolbar" aria-label="Быстрый доступ к сниппетам">
      <span className="snippet-quickbar-label"><Pin size={11} />Быстрый доступ</span>
      <div className="snippet-quickbar-items">
        {snippets.map((snippet) => (
          <button
            key={snippet.id}
            type="button"
            className="snippet-quickbar-item"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRun(snippet.command)}
            title={`${snippet.name}\n${snippet.command}`}
          >
            <Terminal size={11} />
            <span>{snippet.name}</span>
            {snippet.shortcut && <kbd>{snippet.shortcut}</kbd>}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="snippet-quickbar-manage"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onManage}
        title="Настроить сниппеты"
        aria-label="Настроить сниппеты"
      >
        <Settings2 size={13} />
      </button>
    </div>
  )
}
