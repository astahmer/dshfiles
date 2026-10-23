/**
 * The Agents page is a separate slot tree from the reference card, so a request to open one agent there travels through
 * this module store: the card asks, the panel reads and selects, and the request is dropped once it lands.
 */
let focus: string | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const requestAgentFocus = (handle: string): void => {
  focus = handle
  notify()
}

const readAgentFocus = (): string | null => focus

const clearAgentFocus = (): void => {
  if (focus === null) return
  focus = null
  notify()
}

const subscribeAgentFocus = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export class AgentFocusModel {
  static readonly request = requestAgentFocus
  static readonly read = readAgentFocus
  static readonly clear = clearAgentFocus
  static readonly subscribe = subscribeAgentFocus
}
