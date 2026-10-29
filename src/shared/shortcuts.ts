export interface ShortcutKeyEvent {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const
type Modifier = (typeof MODIFIER_ORDER)[number]

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const MODIFIER_NAMES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Meta'
}

const KEY_NAMES = new Set<string>([
  ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
  ...Array.from({ length: 10 }, (_, index) => String(index)),
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
  'Backspace', 'Enter', 'Tab', 'Escape', 'Space',
  'Plus', 'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Backslash',
  'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Backquote'
])

const KEY_CANONICAL = new Map<string, string>()
for (const key of KEY_NAMES) KEY_CANONICAL.set(key.toLowerCase(), key)

const RESERVED_SHORTCUTS = new Set([
  'Ctrl+C', 'Ctrl+V', 'Ctrl+Shift+C', 'Ctrl+Shift+V',
  'Meta+C', 'Meta+V', 'Meta+Shift+C', 'Meta+Shift+V',
  'Ctrl+Insert', 'Shift+Insert', 'Meta+Insert'
])

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Backquote: 'Backquote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape'
}

function keyFromCode(event: ShortcutKeyEvent): string | null {
  const code = event.code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code
  return CODE_KEYS[code] ?? null
}

function canonicalKey(value: string): string | null {
  const upper = value.toUpperCase()
  if (/^[A-Z0-9]$/.test(upper)) return upper
  return KEY_CANONICAL.get(value.toLowerCase()) ?? null
}

function canonicalModifier(value: string): Modifier | null {
  return MODIFIER_NAMES[value.toLowerCase()] ?? null
}

export function shortcutFromEvent(event: ShortcutKeyEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null

  const key = keyFromCode(event)
  if (!key || !KEY_NAMES.has(key)) return null

  const modifiers: Modifier[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Meta')

  return `${modifiers.join('+')}+${key}`
}

export function normalizeShortcut(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null

  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean)
  const key = parts.pop()
  const canonical = key ? canonicalKey(key) : null
  if (!canonical) return null

  const modifiers = new Set<Modifier>()
  for (const part of parts) {
    const modifier = canonicalModifier(part)
    if (!modifier || modifiers.has(modifier)) return null
    modifiers.add(modifier)
  }

  if (!modifiers.has('Ctrl') && !modifiers.has('Alt') && !modifiers.has('Meta')) return null
  return `${MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)).join('+')}+${canonical}`
}

export function isReservedShortcut(shortcut: string): boolean {
  return RESERVED_SHORTCUTS.has(shortcut)
}
