type ChordModifier = 'primary' | 'control' | 'alt' | 'shift'

export interface Chord {
  readonly code: string
  readonly modifiers: readonly ChordModifier[]
}

const MODIFIER_ORDER: readonly ChordModifier[] = ['control', 'primary', 'alt', 'shift']
const isChordModifier = (value: string): value is ChordModifier => MODIFIER_ORDER.some(modifier => modifier === value)
const MODIFIER_CODES = new Set(['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight'])

export const parseChord = (value: string | null): Chord | null => {
  if (value === null) return null
  const parts = value.split('+')
  const code = parts.pop()
  if (code === undefined || code.length === 0 || MODIFIER_CODES.has(code)) return null
  const modifiers = parts.filter(isChordModifier)
  if (modifiers.length !== parts.length || modifiers.length === 0) return null
  return { code, modifiers: MODIFIER_ORDER.filter(modifier => modifiers.includes(modifier)) }
}

export const serializeChord = (chord: Chord): string => [...MODIFIER_ORDER.filter(modifier => chord.modifiers.includes(modifier)), chord.code].join('+')

interface KeyState {
  readonly code: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

const chordFromEvent = (event: KeyState, mac: boolean): Chord | null => {
  if (MODIFIER_CODES.has(event.code)) return null
  const primary = mac ? event.metaKey : event.ctrlKey
  const modifiers: ChordModifier[] = []
  if (mac && event.ctrlKey) modifiers.push('control')
  if (!mac && event.metaKey) return null
  if (primary) modifiers.push('primary')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  if (!modifiers.includes('primary') && !modifiers.includes('control') && !modifiers.includes('alt')) return null
  return { code: event.code, modifiers }
}

const matchesChord = (event: KeyState, chord: Chord, mac: boolean): boolean => {
  const recorded = chordFromEvent(event, mac)
  return recorded !== null && serializeChord(recorded) === serializeChord(chord)
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Space: 'Space',
  Enter: '↵',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

const keyLabel = (code: string): string => {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return KEY_LABELS[code] ?? code
}

const formatChord = (chord: Chord, mac: boolean): string[] => [
  ...chord.modifiers.map(modifier => {
    if (modifier === 'primary') return mac ? '⌘' : 'Ctrl'
    if (modifier === 'control') return mac ? '⌃' : 'Ctrl'
    if (modifier === 'alt') return mac ? '⌥' : 'Alt'
    return mac ? '⇧' : 'Shift'
  }),
  keyLabel(chord.code),
]

interface HostBinding {
  readonly code: string
  readonly secondCode?: string
  readonly modifiers: readonly ('control' | 'alt' | 'shift' | 'meta')[]
}

const sameAsHostBinding = (chord: Chord, binding: HostBinding | null, mac: boolean): boolean => {
  if (binding === null || binding.secondCode !== undefined || binding.code !== chord.code) return false
  const physical = new Set(
    chord.modifiers.map(modifier => {
      if (modifier === 'primary') return mac ? 'meta' : 'control'
      return modifier
    }),
  )
  return physical.size === binding.modifiers.length && binding.modifiers.every(modifier => physical.has(modifier))
}

const isMacPlatform = (platform: string): boolean => platform.startsWith('Mac') || platform === 'macOS' || platform === 'iPhone' || platform === 'iPad'

export class KeyboardShortcutModel {
  static readonly chordFromEvent = chordFromEvent
  static readonly formatChord = formatChord
  static readonly isMacPlatform = isMacPlatform
  static readonly matchesChord = matchesChord
  static readonly sameAsHostBinding = sameAsHostBinding
}
