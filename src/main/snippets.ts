import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Snippet } from '../shared/types'

export class SnippetStore {
  private data: Snippet[] = []
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  static defaultPath(): string {
    return join(app.getPath('userData'), 'snippets.json')
  }

  async init(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) this.data = parsed
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.error('Failed to read snippets:', error)
      this.data = []
    }
  }

  async list(): Promise<Snippet[]> {
    await this.init()
    return this.data
  }

 async save(input: Omit<Snippet, 'id'> & { id?: string }): Promise<Snippet> {
    await this.init()
    if (!input.name.trim() || !input.command.trim()) throw new Error('Название и команда обязательны')
    
    const group = String(input.group ?? '').trim()

    if (input.id) {
      const index = this.data.findIndex((s) => s.id === input.id)
      if (index === -1) throw new Error('Сниппет не найден')
      this.data[index] = { ...this.data[index], name: input.name, command: input.command, group }
      await this.persist()
      return this.data[index]
    }

    const snippet: Snippet = {
      id: randomUUID(),
      name: input.name,
      command: input.command,
      group
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