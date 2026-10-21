/**
 * The Backlog page is a separate slot tree from the reference card, so a request to open one item there travels through
 * this module store: the card asks, the panel reads and selects, and the request is dropped once it lands.
 */
let focus: number | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const requestBacklogFocus = (id: number): void => {
  focus = id
  notify()
}

const readBacklogFocus = (): number | null => focus

const clearBacklogFocus = (): void => {
  if (focus === null) return
  focus = null
  notify()
}

const subscribeBacklogFocus = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export class BacklogFocusModel {
  static readonly request = requestBacklogFocus
  static readonly read = readBacklogFocus
  static readonly clear = clearBacklogFocus
  static readonly subscribe = subscribeBacklogFocus
}
