import { z } from 'zod/mini'

export interface ShortcutBindingInput {
  readonly code: string
  readonly modifiers: readonly ('primary' | 'control' | 'alt' | 'shift' | 'meta')[]
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  enter: 'Enter',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
}

const KEY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(NAMED_KEYS).map(([name, code]) => [code, name.length === 1 ? name : `${name.charAt(0).toUpperCase()}${name.slice(1)}`]),
)

const MODIFIERS: Readonly<Record<string, ShortcutBindingInput['modifiers'][number]>> = {
  mod: 'primary',
  primary: 'primary',
  cmd: 'meta',
  meta: 'meta',
  ctrl: 'control',
  control: 'control',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
}

const SHORTCUT_ID = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u

const NormalizedBinding = z.object({ code: z.string(), modifiers: z.array(z.enum(['control', 'alt', 'shift', 'meta'])) })

const codeOf = (key: string): string | undefined => {
  if (/^[a-z]$/u.test(key)) return `Key${key.toUpperCase()}`
  if (/^\d$/u.test(key)) return `Digit${key}`
  if (/^f\d{1,2}$/u.test(key)) return key.toUpperCase()
  return NAMED_KEYS[key]
}

const keyOf = (code: string): string | undefined => {
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3)
  if (/^Digit\d$/u.test(code)) return code.slice(5)
  if (/^F\d{1,2}$/u.test(code)) return code
  return KEY_NAMES[code]
}

/** Converts a `Command`'s chords (`Mod+Shift+K`) to and from the Host shortcut registry's bindings. */
export class CommandChords {
  /** The Host binding of one chord, or undefined when a part is unknown. */
  static toBinding = (chord: string): ShortcutBindingInput | undefined => {
    const parts = chord.split('+').map(part => part.trim().toLowerCase())
    const code = codeOf(parts.at(-1) ?? '')
    const modifiers = parts.slice(0, -1).map(part => MODIFIERS[part])
    if (code === undefined || modifiers.some(modifier => modifier === undefined)) return undefined
    return { code, modifiers: modifiers.filter(modifier => modifier !== undefined) }
  }

  /** The chord of a Host binding, written with `Mod` for the platform's primary modifier. */
  static fromBinding = (input: { readonly binding: unknown; readonly platform: string }): string | undefined => {
    const binding = NormalizedBinding.safeParse(input.binding).data
    if (binding === undefined) return undefined
    const key = keyOf(binding.code)
    if (key === undefined) return undefined
    const primary = input.platform === 'macos' ? 'meta' : 'control'
    const order = ['primary', 'control', 'meta', 'alt', 'shift'] as const
    const names = { primary: 'Mod', control: 'Ctrl', meta: 'Meta', alt: 'Alt', shift: 'Shift' }
    const held = new Set(binding.modifiers.map(modifier => (modifier === primary ? 'primary' : modifier)))
    return [...order.filter(modifier => held.has(modifier)).map(modifier => names[modifier]), key].join('+')
  }

  /** The Host shortcut id of an editable command (`@acme/plugin.open` → `acme-plugin.open`), or undefined when the id cannot map. */
  static shortcutId = (commandId: string): string | undefined => {
    const id = commandId.replace(/^@/u, '').replaceAll('/', '-')
    return SHORTCUT_ID.test(id) ? id : undefined
  }
}
