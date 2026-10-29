import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { isReservedShortcut, normalizeShortcut } from '../shared/shortcuts'
import type { Snippet } from '../shared/types'

export class SnippetStore {
  private data: Snippet[] = []
  private loaded = false
  private initPromise: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  static defaultPath(): string {
    return join(app.getPath('userData'), 'snippets.json')
  }

  async init(): Promise<void> {
    if (this.loaded) return
    if (!this.initPromise) this.initPromise = this.load()
    await this.initPromise
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.data = parsed
          .filter((item): item is Snippet => Boolean(item) && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.command === 'string')
          .map((item) => {
            const shortcut = typeof item.shortcut === 'string' ? normalizeShortcut(item.shortcut) ?? undefined : undefined
            return {
              id: item.id,
              name: item.name,
              command: item.command,
              group: typeof item.group === 'string' ? item.group.trim() || undefined : undefined,
              quickAccess: item.quickAccess === true,
              ...(shortcut ? { shortcut } : {})
            }
          })
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.error('Failed to read snippets:', error)
      this.data = []
    } finally {
      this.loaded = true
    }
  }

  async list(): Promise<Snippet[]> {
    await this.init()
    return this.data
  }

  async save(input: Omit<Snippet, 'id'> & { id?: string }): Promise<Snippet> {
    await this.init()
    const name = String(input.name ?? '').trim()
    const command = String(input.command ?? '')
    if (!name || !command.trim()) throw new Error('Название и команда обязательны')

    const group = String(input.group ?? '').trim() || undefined
    const rawShortcut = typeof input.shortcut === 'string' ? input.shortcut.trim() : ''
    const shortcut = rawShortcut ? normalizeShortcut(rawShortcut) ?? undefined : undefined
    if (rawShortcut && !shortcut) throw new Error('Некорректное сочетание клавиш')
    if (shortcut && isReservedShortcut(shortcut)) throw new Error('Это сочетание зарезервировано терминалом')

    const duplicate = shortcut
      ? this.data.find((item) => item.id !== input.id && item.shortcut?.toLowerCase() === shortcut.toLowerCase())
      : undefined
    if (duplicate) throw new Error(`Сочетание ${shortcut} уже назначено сниппету «${duplicate.name}»`)

    const quickAccess = input.quickAccess === true

    if (input.id) {
      const index = this.data.findIndex((s) => s.id === input.id)
      if (index === -1) throw new Error('Сниппет не найден')
      this.data[index] = { ...this.data[index], name, command, group, shortcut, quickAccess }
      await this.persist()
      return this.data[index]
    }

    const snippet: Snippet = {
      id: randomUUID(),
      name,
      command,
      group,
      shortcut,
      quickAccess
    }
    this.data.push(snippet)
    await this.persist()
    return snippet
  }


  async remove(id: string): Promise<void> {
    await this.init()
    this.data = this.data.filter((s) => s.id !== id)
    await this.persist()
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2)
    const write = this.writeQueue.then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const tempPath = `${this.filePath}.tmp`
      await fs.writeFile(tempPath, snapshot, 'utf8')
      await fs.rename(tempPath, this.filePath)
    })
    this.writeQueue = write.catch(() => undefined)
    await write
  }
}