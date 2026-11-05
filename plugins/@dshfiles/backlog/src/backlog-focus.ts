/**
 * The Backlog page is a separate slot tree from the reference card, so a request to open one item there travels through
 * this module store: the card asks, the panel reads and selects, and the request is dropped once it lands.
 */
/** An item's id, or its short ref when only the ref is known (a written `b:k3f9` link): the panel resolves it. */
let focus: number | string | null = null
let capture: { readonly id: number; readonly text: string } | null = null
let nextCaptureId = 0
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const requestBacklogFocus = (id: number | string): void => {
  focus = id
  notify()
}

const readBacklogFocus = (): number | string | null => focus

const takeBacklogFocus = (id: number | string): number | string | null => {
  if (focus !== id) return null
  focus = null
  notify()
  return id
}

const requestBacklogCapture = (text: string): void => {
  capture = { id: ++nextCaptureId, text }
  notify()
}

const readBacklogCapture = (): { readonly id: number; readonly text: string } | null => capture

const takeBacklogCapture = (id: number): { readonly id: number; readonly text: string } | null => {
  if (capture?.id !== id) return null
  // Preserve the claimed request before clearing the shared slot.
  // oxlint-disable-next-line antislop/no-passthrough-variable
  const taken = capture
  capture = null
  notify()
  return taken
}

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
  static readonly take = takeBacklogFocus
  static readonly requestCapture = requestBacklogCapture
  static readonly readCapture = readBacklogCapture
  static readonly takeCapture = takeBacklogCapture
  static readonly clearCapture = clearBacklogCapture
  static readonly clear = clearBacklogFocus
  static readonly subscribe = subscribeBacklogFocus
}
