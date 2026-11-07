import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SnippetStore } from './snippets'

const electronState = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronState.userData)
  }
}))

describe('SnippetStore', () => {
  let dir: string
  let filePath: string
  let store: SnippetStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sheller-snippets-'))
    filePath = join(dir, 'snippets.json')
    electronState.userData = dir
    store = new SnippetStore(filePath)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('возвращает путь по умолчанию', () => {
    expect(SnippetStore.defaultPath()).toBe(join(dir, 'snippets.json'))
  })

  it('загружает пустой список при отсутствии файла', async () => {
    await expect(store.list()).resolves.toEqual([])
  })

  it('фильтрует и нормализует сниппеты при загрузке', async () => {
    await writeFile(filePath, JSON.stringify([
      { id: '1', name: 'List', command: 'ls', group: '  files  ', shortcut: 'ctrl+shift+l', quickAccess: true },
      { id: '2', name: 'Bad shortcut', command: 'pwd', shortcut: 'oops' },
      { id: 3, name: 'Invalid', command: 'x' },
      { id: '4', name: 'No command' },
      null,
      { id: '5', name: 'Plain', command: 'echo', group: '  ', quickAccess: 'yes' }
    ]), 'utf8')
    await expect(store.list()).resolves.toEqual([
      { id: '1', name: 'List', command: 'ls', group: 'files', quickAccess: true, shortcut: 'Ctrl+Shift+L' },
      { id: '2', name: 'Bad shortcut', command: 'pwd', group: undefined, quickAccess: false },
      { id: '5', name: 'Plain', command: 'echo', group: undefined, quickAccess: false }
    ])
  })

  it('сохраняет пустой список при повреждённом файле', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await writeFile(filePath, '{broken', 'utf8')
    const broken = new SnippetStore(filePath)
    await expect(broken.list()).resolves.toEqual([])
    expect(error).toHaveBeenCalled()
  })

  it('игнорирует не-массив в файле', async () => {
    await writeFile(filePath, JSON.stringify({ snippets: [] }), 'utf8')
    await expect(store.list()).resolves.toEqual([])
  })

  it('требует название и команду', async () => {
    await expect(store.save({ name: '', command: 'ls' })).rejects.toThrow('Название и команда обязательны')
    await expect(store.save({ name: 'List', command: '   ' })).rejects.toThrow('Название и команда обязательны')
  })

  it('валидирует сочетание клавиш', async () => {
    await expect(store.save({ name: 'List', command: 'ls', shortcut: 'oops' })).rejects.toThrow('Некорректное сочетание')
    await expect(store.save({ name: 'Copy', command: 'ls', shortcut: 'ctrl+c' })).rejects.toThrow('зарезервировано')
  })

  it('запрещает дубликаты сочетаний без учёта регистра', async () => {
    const created = await store.save({ name: 'List', command: 'ls', shortcut: 'ctrl+shift+l' })
    await expect(store.save({ name: 'Other', command: 'pwd', shortcut: 'CTRL+SHIFT+L' }))
      .rejects.toThrow('уже назначено сниппету «List»')
    await expect(store.save({ id: created.id, name: 'List', command: 'ls -la', shortcut: 'ctrl+shift+l' }))
      .resolves.toMatchObject({ command: 'ls -la' })
    await expect(store.save({ name: 'No shortcut', command: 'pwd', shortcut: 'ctrl+shift+l' }))
      .rejects.toThrow('уже назначено')
  })

  it('создаёт и обновляет сниппет', async () => {
    const created = await store.save({ name: '  List  ', command: ' ls ', group: ' files ', shortcut: 'ctrl+alt+l', quickAccess: true })
    expect(created).toMatchObject({
      name: 'List',
      command: ' ls ',
      group: 'files',
      shortcut: 'Ctrl+Alt+L',
      quickAccess: true
    })
    expect(created.id).toBeTruthy()

    const updated = await store.save({ id: created.id, name: 'List files', command: 'ls -la', group: '' })
    expect(updated).toMatchObject({ id: created.id, name: 'List files', command: 'ls -la', group: undefined, shortcut: undefined, quickAccess: false })

    const stored = JSON.parse(await readFile(filePath, 'utf8')) as unknown[]
    expect(stored).toHaveLength(1)
  })

  it('запрещает обновление несуществующего сниппета', async () => {
    await expect(store.save({ id: 'missing', name: 'X', command: 'x' })).rejects.toThrow('Сниппет не найден')
  })

  it('удаляет сниппет и сохраняет изменения', async () => {
    const first = await store.save({ name: 'One', command: 'one' })
    await store.save({ name: 'Two', command: 'two' })
    await store.remove(first.id)
    await expect(store.list()).resolves.toMatchObject([{ name: 'Two' }])
    const stored = JSON.parse(await readFile(filePath, 'utf8')) as Array<{ name: string }>
    expect(stored.map((item) => item.name)).toEqual(['Two'])
  })

  it('пробрасывает ошибку записи', async () => {
    const { mkdir } = await import('node:fs/promises')
    const target = join(dir, 'directory')
    await mkdir(target)
    const broken = new SnippetStore(target)
    await expect(broken.save({ name: 'One', command: 'one' })).rejects.toBeTruthy()
  })
})
