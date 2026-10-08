export type PaletteMode = 'all' | 'threads'

export const PALETTE_EVENT = 'dshfiles:command-palette'

export interface ThreadCandidate {
  readonly id: string
  readonly title: string
  readonly project: string
  readonly cwd: string
  readonly updatedAt: number
}

const WORD_BOUNDARY = /[\s\-_/.·:]/

/**
 * Subsequence score: every query character must appear in order. Consecutive
 * runs, word starts and an exact substring score higher; null means no match.
 */
export const fuzzyScore = (query: string, text: string): number | null => {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return 0
  const haystack = text.toLocaleLowerCase()
  const substringAt = haystack.indexOf(needle)
  if (substringAt >= 0) return 1000 - substringAt + (substringAt === 0 || WORD_BOUNDARY.test(haystack[substringAt - 1] ?? '') ? 200 : 0)

  let score = 0
  let cursor = 0
  let previous = -2
  for (const character of needle) {
    if (character === ' ') continue
    const found = haystack.indexOf(character, cursor)
    if (found < 0) return null
    score += 10
    if (found === previous + 1) score += 15
    if (found === 0 || WORD_BOUNDARY.test(haystack[found - 1] ?? '')) score += 20
    score -= Math.min(found - cursor, 10)
    previous = found
    cursor = found + 1
  }
  return score
}

/** Recent threads for an empty query; otherwise the best title, project, path or id matches. */
export const rankThreads = ({ threads, query, limit }: { threads: readonly ThreadCandidate[]; query: string; limit: number }): ThreadCandidate[] => {
  if (query.trim().length === 0) return [...threads].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit)
  const normalizedId = query.trim().toLocaleLowerCase()
  return threads
    .flatMap(thread => {
      const scores = [
        (fuzzyScore(query, thread.title) ?? -Infinity) * 3,
        (fuzzyScore(query, thread.project) ?? -Infinity) * 2,
        fuzzyScore(query, thread.cwd) ?? -Infinity,
        thread.id.toLocaleLowerCase().startsWith(normalizedId) ? 2500 : -Infinity,
      ]
      const best = Math.max(...scores)
      return best === -Infinity ? [] : [{ thread, best }]
    })
    .sort((left, right) => right.best - left.best || right.thread.updatedAt - left.thread.updatedAt)
    .slice(0, limit)
    .map(({ thread }) => thread)
}

export const filterByLabel = <Item extends { readonly label: string }>(items: readonly Item[], query: string): Item[] => {
  if (query.trim().length === 0) return [...items]
  return items
    .flatMap(item => {
      const score = fuzzyScore(query, item.label)
      return score === null ? [] : [{ item, score }]
    })
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item)
}

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

/** Record a chord from a keydown; a lone modifier or an unmodified key is not a chord. */
export const chordFromEvent = (event: KeyState, mac: boolean): Chord | null => {
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

export const matchesChord = (event: KeyState, chord: Chord, mac: boolean): boolean => {
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

export const formatChord = (chord: Chord, mac: boolean): string[] => [
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

/** Whether a Host shortcut catalog binding is the same physical chord, so the Host keeps it. */
export const sameAsHostBinding = (chord: Chord, binding: HostBinding | null, mac: boolean): boolean => {
  if (binding === null || binding.secondCode !== undefined || binding.code !== chord.code) return false
  const physical = new Set(
    chord.modifiers.map(modifier => {
      if (modifier === 'primary') return mac ? 'meta' : 'control'
      return modifier
    }),
  )
  return physical.size === binding.modifiers.length && binding.modifiers.every(modifier => physical.has(modifier))
}

export const isMacPlatform = (platform: string): boolean => platform.startsWith('Mac') || platform === 'macOS' || platform === 'iPhone' || platform === 'iPad'
