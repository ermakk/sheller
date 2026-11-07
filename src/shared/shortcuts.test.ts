import { describe, expect, it } from 'vitest'
import { isReservedShortcut, normalizeShortcut, shortcutFromEvent, type ShortcutKeyEvent } from './shortcuts'

function event(overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    key: 'a',
    code: 'KeyA',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides
  }
}

describe('shortcutFromEvent', () => {
  it('игнорирует нажатие только модификатора', () => {
    expect(shortcutFromEvent(event({ key: 'Control' }))).toBeNull()
    expect(shortcutFromEvent(event({ key: 'Shift' }))).toBeNull()
    expect(shortcutFromEvent(event({ key: 'Alt' }))).toBeNull()
    expect(shortcutFromEvent(event({ key: 'Meta' }))).toBeNull()
  })

  it('требует Ctrl, Alt или Meta', () => {
    expect(shortcutFromEvent(event({ shiftKey: true }))).toBeNull()
    expect(shortcutFromEvent(event())).toBeNull()
  })

  it('собирает сочетание в фиксированном порядке', () => {
    expect(shortcutFromEvent(event({ ctrlKey: true }))).toBe('Ctrl+A')
    expect(shortcutFromEvent(event({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }))).toBe('Ctrl+Alt+Shift+Meta+A')
    expect(shortcutFromEvent(event({ altKey: true, shiftKey: true, code: 'KeyX', key: 'x' }))).toBe('Alt+Shift+X')
  })

  it('поддерживает цифры, функциональные клавиши и спецклавиши', () => {
    expect(shortcutFromEvent(event({ ctrlKey: true, code: 'Digit1', key: '1' }))).toBe('Ctrl+1')
    expect(shortcutFromEvent(event({ ctrlKey: true, code: 'F12', key: 'F12' }))).toBe('Ctrl+F12')
    expect(shortcutFromEvent(event({ ctrlKey: true, code: 'Space', key: ' ' }))).toBe('Ctrl+Space')
    expect(shortcutFromEvent(event({ ctrlKey: true, code: 'ArrowUp', key: 'ArrowUp' }))).toBe('Ctrl+ArrowUp')
    expect(shortcutFromEvent(event({ ctrlKey: true, code: 'BracketLeft', key: '[' }))).toBe('Ctrl+BracketLeft')
  })

  it('возвращает null для неизвестного кода', () => {
    expect(shortcutFromEvent(event({ ctrlKey: true, code: 'Unknown', key: '?' }))).toBeNull()
  })
})

describe('normalizeShortcut', () => {
  it('возвращает null для пустой строки', () => {
    expect(normalizeShortcut('')).toBeNull()
    expect(normalizeShortcut('   ')).toBeNull()
  })

  it('нормализует регистр и порядок модификаторов', () => {
    expect(normalizeShortcut('shift+ctrl+a')).toBe('Ctrl+Shift+A')
    expect(normalizeShortcut(' meta + alt + b ')).toBe('Alt+Meta+B')
    expect(normalizeShortcut('Ctrl+Shift+F5')).toBe('Ctrl+Shift+F5')
  })

  it('поддерживает спецклавиши', () => {
    expect(normalizeShortcut('ctrl+plus')).toBe('Ctrl+Plus')
    expect(normalizeShortcut('ctrl+arrowdown')).toBe('Ctrl+ArrowDown')
    expect(normalizeShortcut('ctrl+space')).toBe('Ctrl+Space')
  })

  it('отклоняет неизвестную клавишу или модификатор', () => {
    expect(normalizeShortcut('ctrl+unknown')).toBeNull()
    expect(normalizeShortcut('hyper+a')).toBeNull()
  })

  it('отклоняет повторяющийся модификатор', () => {
    expect(normalizeShortcut('ctrl+ctrl+a')).toBeNull()
  })

  it('требует Ctrl, Alt или Meta', () => {
    expect(normalizeShortcut('shift+a')).toBeNull()
    expect(normalizeShortcut('a')).toBeNull()
  })

  it('отклоняет несколько клавиш без модификатора', () => {
    expect(normalizeShortcut('a+b')).toBeNull()
  })
})

describe('isReservedShortcut', () => {
  it('распознаёт зарезервированные сочетания', () => {
    expect(isReservedShortcut('Ctrl+C')).toBe(true)
    expect(isReservedShortcut('Ctrl+V')).toBe(true)
    expect(isReservedShortcut('Ctrl+Shift+C')).toBe(true)
    expect(isReservedShortcut('Ctrl+Insert')).toBe(true)
    expect(isReservedShortcut('Shift+Insert')).toBe(true)
    expect(isReservedShortcut('Meta+Insert')).toBe(true)
  })

  it('не считает обычные сочетания зарезервированными', () => {
    expect(isReservedShortcut('Ctrl+Alt+K')).toBe(false)
  })
})
