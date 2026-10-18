/**
 * The memory panel is a separate slot tree from the reference card, so a request to open one item there travels through
 * this module store: the card asks, the panel reads and selects, and the request is dropped once it lands.
 */
export interface MemoryFocus {
  readonly id: string
  readonly range?: string
}

let focus: MemoryFocus | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const requestMemoryFocus = (next: MemoryFocus): void => {
  focus = next
  notify()
}

const readMemoryFocus = (): MemoryFocus | null => focus

const clearMemoryFocus = (): void => {
  if (focus === null) return
  focus = null
  notify()
}

const subscribeMemoryFocus = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The note id a `n:<id>` reference names, or undefined for a digest. */
const noteIdOfFocus = (focus: MemoryFocus | null): number | undefined => {
  if (focus === null || !focus.id.startsWith('n:')) return undefined
  const id = Number(focus.id.slice(2))
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/** The thread digest id a `t:<id>` reference names; full Session ids normalize to the digest id. */
const threadIdOfFocus = (focus: MemoryFocus | null): string | undefined => {
  if (focus === null || !focus.id.startsWith('t:')) return undefined
  return focus.id.slice(2).replace(/^session-/u, '')
}

export class MemoryFocusModel {
  static readonly request = requestMemoryFocus
  static readonly read = readMemoryFocus
  static readonly clear = clearMemoryFocus
  static readonly subscribe = subscribeMemoryFocus
  static readonly noteIdOf = noteIdOfFocus
  static readonly threadIdOf = threadIdOfFocus
}
