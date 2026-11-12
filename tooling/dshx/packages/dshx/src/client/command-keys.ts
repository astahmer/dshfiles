/**
 * One grammar for a `Command`'s keys, shared by the matcher (`@dshfiles/shortcuts`), the palette, the cheat sheet and
 * the kit's menu and tooltip hints, so a key spec reads the same everywhere it is shown and the same where it runs.
 *
 * A spec is one step (`Mod+Shift+K`, `Alt+J`, `J`, `Shift+J`, `?`, `Enter`) or two steps separated by a space
 * (`G I`: G, then I). Keys are physical (`event.code`), so a layout that moves letters still finds them where the
 * label says, the way the Host's own registry matches.
 */

export interface KeyStep {
  /** `KeyboardEvent.code`, e.g. `KeyJ`, `Digit1`, `Enter`, `Slash`. */
  readonly code: string
  /** The platform primary modifier: ⌘ on macOS, Ctrl elsewhere. */
  readonly primary: boolean
  readonly shift: boolean
  readonly alt: boolean
  /** A typed character the step also answers to, for a symbol like `?` that layouts put on different keys. */
  readonly char?: string
}

export interface ParsedKeys {
  readonly spec: string
  readonly steps: readonly [KeyStep] | readonly [KeyStep, KeyStep]
  /** No primary modifier: a text field would take the key as typing, so it never fires there. */
  readonly typesText: boolean
  /**
   * No modifier but Shift on a printable key (a letter, digit or symbol): a character-key shortcut in the sense of WCAG
   * 2.1.4, off when the user turns single-key shortcuts off. Enter, Escape, Space, Tab and the arrows are not.
   */
  readonly characterKey: boolean
}

const NAMED = new Map<string, string>([
  [',', 'Comma'],
  ['.', 'Period'],
  ['/', 'Slash'],
  ['\\', 'Backslash'],
  [';', 'Semicolon'],
  ["'", 'Quote'],
  ['[', 'BracketLeft'],
  [']', 'BracketRight'],
  ['-', 'Minus'],
  ['=', 'Equal'],
  ['`', 'Backquote'],
  ['enter', 'Enter'],
  ['return', 'Enter'],
  ['escape', 'Escape'],
  ['esc', 'Escape'],
  ['space', 'Space'],
  ['tab', 'Tab'],
  ['backspace', 'Backspace'],
  ['delete', 'Delete'],
  ['up', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['arrowup', 'ArrowUp'],
  ['arrowdown', 'ArrowDown'],
  ['arrowleft', 'ArrowLeft'],
  ['arrowright', 'ArrowRight'],
  ['home', 'Home'],
  ['end', 'End'],
])

/** Symbols typed with Shift on a US layout: the step matches the code with Shift, or the typed character itself. */
const SHIFTED = new Map<string, string>([['?', 'Slash']])

const PRIMARY = new Set(['mod', 'primary', 'cmd', 'command', 'ctrl', 'control', 'meta'])

/** The `KeyboardEvent.code` for one lower-case key name: a letter, a digit, a function key or a named key. */
const codeOf = (lower: string): string | undefined => {
  if (/^[a-z]$/u.test(lower)) return `Key${lower.toUpperCase()}`
  if (/^\d$/u.test(lower)) return `Digit${lower}`
  if (/^f\d{1,2}$/u.test(lower)) return lower.toUpperCase()
  return NAMED.get(lower)
}

const parseStep = (step: string): KeyStep | undefined => {
  // `Mod++` would name the plus key; nothing binds it, so a trailing empty part is a typo.
  const parts = step.split('+').map(part => part.trim())
  const name = parts.at(-1)
  if (name === undefined || name === '') return undefined
  const modifiers = parts.slice(0, -1).map(part => part.toLowerCase())
  let primary = false
  let shift = false
  let alt = false
  for (const modifier of modifiers) {
    if (PRIMARY.has(modifier)) primary = true
    else if (modifier === 'shift') shift = true
    else if (modifier === 'alt' || modifier === 'option' || modifier === 'opt') alt = true
    else return undefined
  }
  const lower = name.toLowerCase()
  const shifted = SHIFTED.get(name)
  if (shifted !== undefined) return { code: shifted, primary, shift: true, alt, char: name }
  const code = codeOf(lower)
  if (code === undefined) return undefined
  return { code, primary, shift, alt }
}

const PRINTABLE_CODES = new Set(['Comma', 'Period', 'Slash', 'Backslash', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Minus', 'Equal', 'Backquote'])

const isPrintable = (step: KeyStep): boolean => step.char !== undefined || /^(Key[A-Z]|Digit\d)$/u.test(step.code) || PRINTABLE_CODES.has(step.code)

const parse = (spec: string): ParsedKeys | undefined => {
  const words = spec.trim().split(/\s+/u)
  if (words.length === 0 || words.length > 2) return undefined
  const steps = words.map(parseStep)
  const first = steps[0]
  const second = steps[1]
  if (first === undefined) return undefined
  if (words.length === 2 && second === undefined) return undefined
  const all = second === undefined ? [first] : [first, second]
  const typesText = all.every(step => !step.primary)
  const characterKey = all.every(step => !step.primary && !step.alt && isPrintable(step))
  // A sequence is a run of plain keys; a chord inside one would hold a modifier across the pause.
  if (all.length === 2 && !characterKey) return undefined
  return {
    spec,
    steps: second === undefined ? [first] : [first, second],
    typesText,
    characterKey,
  }
}

/** The keycap a code shows when no typed character names it. */
const CAPS = new Map<string, string>([
  ['Enter', '↵'],
  ['Escape', 'Esc'],
  ['Space', 'Space'],
  ['Tab', 'Tab'],
  ['Backspace', '⌫'],
  ['Delete', 'Del'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Minus', '-'],
  ['Equal', '='],
  ['Backquote', '`'],
  ['Home', 'Home'],
  ['End', 'End'],
])

const capOf = (code: string, char: string | undefined): string => {
  if (char !== undefined) return char
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3)
  if (/^Digit\d$/u.test(code)) return code.slice(5)
  return CAPS.get(code) ?? code
}

/** Keycaps of one spec, one array per step: `Mod+Shift+K` → `[['⌘', '⇧', 'K']]`, `G I` → `[['G'], ['I']]`. */
const keycaps = (spec: string, mac: boolean): readonly (readonly string[])[] => {
  const parsed = parse(spec)
  if (parsed === undefined) return [[spec]]
  return parsed.steps.map(step => [
    ...(step.primary ? [mac ? '⌘' : 'Ctrl'] : []),
    ...(step.alt ? [mac ? '⌥' : 'Alt'] : []),
    ...(step.shift && step.char === undefined ? [mac ? '⇧' : 'Shift'] : []),
    capOf(step.code, step.char),
  ])
}

/** Spoken form for `aria-keyshortcuts`, or undefined for a sequence (ARIA has no syntax for one). */
const aria = (spec: string): string | undefined => {
  const parsed = parse(spec)
  if (parsed === undefined || parsed.steps.length !== 1) return undefined
  const step = parsed.steps[0]
  const key = step.char ?? (/^Key[A-Z]$/u.test(step.code) ? step.code.slice(3) : /^Digit\d$/u.test(step.code) ? step.code.slice(5) : step.code)
  return [...(step.primary ? ['Meta'] : []), ...(step.alt ? ['Alt'] : []), ...(step.shift && step.char === undefined ? ['Shift'] : []), key].join('+')
}

/**
 * Fold a run of single digits (`1`…`9`) into one `1–9` entry, so a choice key reads as one row in the cheat sheet.
 * Other specs keep their order.
 */
const compact = (specs: readonly string[]): readonly string[] => {
  const digits = specs.filter(spec => /^\d$/u.test(spec.trim()))
  if (digits.length < 3) return specs
  const sorted = [...digits].map(Number).sort((left, right) => left - right)
  const consecutive = sorted.every((value, index) => index === 0 || value === (sorted[index - 1] ?? 0) + 1)
  if (!consecutive) return specs
  const range = `${String(sorted[0])}–${String(sorted.at(-1))}`
  const firstDigit = specs.findIndex(spec => /^\d$/u.test(spec.trim()))
  return [
    ...specs.slice(0, firstDigit).filter(spec => !/^\d$/u.test(spec.trim())),
    range,
    ...specs.slice(firstDigit).filter(spec => !/^\d$/u.test(spec.trim())),
  ]
}

const isMacPlatform = (platform: string | undefined): boolean =>
  platform !== undefined &&
  (platform === 'MacIntel' || platform === 'macOS' || platform === 'macos' || platform.startsWith('Mac') || /iPhone|iPad|iPod/u.test(platform))

/** The current browser runs on macOS or iOS, where the primary modifier is ⌘. */
const currentIsMac = (): boolean => 'navigator' in globalThis && isMacPlatform(navigator.platform)

export class CommandKeys {
  static readonly parse = parse
  static readonly keycaps = keycaps
  static readonly aria = aria
  static readonly compact = compact
  static readonly isMacPlatform = isMacPlatform
  static readonly currentIsMac = currentIsMac
  /** How long the second key of a sequence may wait after the first. */
  static readonly SEQUENCE_MS = 1200
}
