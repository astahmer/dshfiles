/**
 * The Backlog page is a separate slot tree from the reference card, so a request to open one item there travels through
 * this module store: the card asks, the panel reads and selects, and the request is dropped once it lands.
 */
let focus: number | null = null
let capture: { readonly id: number; readonly text: string } | null = null
let nextCaptureId = 0
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const requestBacklogFocus = (id: number): void => {
  focus = id
  notify()
}

const readBacklogFocus = (): number | null => focus

const requestBacklogCapture = (text: string): void => {
  capture = { id: ++nextCaptureId, text }
  notify()
}

const readBacklogCapture = (): { readonly id: number; readonly text: string } | null => capture

const clearBacklogCapture = (): void => {
  if (capture === null) return
  capture = null
  notify()
}

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
  static readonly requestCapture = requestBacklogCapture
  static readonly readCapture = readBacklogCapture
  static readonly clearCapture = clearBacklogCapture
  static readonly clear = clearBacklogFocus
  static readonly subscribe = subscribeBacklogFocus
}
