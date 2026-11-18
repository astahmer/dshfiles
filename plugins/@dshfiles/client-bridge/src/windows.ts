import { BridgeLimits, type WindowState, type WindowView } from './api.js'

/** One announced window as the Host keeps it. */
export interface KnownWindow extends WindowState {
  readonly lastSeenAt: number
  /** When it last had focus (or first appeared); the tie-breaker between windows. */
  readonly lastActiveAt: number
}

export type PickResult =
  | { readonly kind: 'picked'; readonly window: KnownWindow }
  | { readonly kind: 'no-window' }
  | { readonly kind: 'unknown-window'; readonly clientId: string }
  | { readonly kind: 'unknown-tool'; readonly window: KnownWindow }

/**
 * Record a window's announcement.
 * @param previous - what the Host knew of it, if anything.
 * @param state - the announcement.
 * @param now - the time it arrived.
 * @returns the window as the Host keeps it.
 */
const announce = (previous: KnownWindow | undefined, state: WindowState, now: number): KnownWindow => ({
  ...state,
  lastSeenAt: now,
  lastActiveAt: previous === undefined || state.focused ? now : previous.lastActiveAt,
})

/** Windows heard from within the TTL. */
const live = (windows: Iterable<KnownWindow>, now: number): readonly KnownWindow[] =>
  [...windows].filter(window => now - window.lastSeenAt <= BridgeLimits.windowTtlMs)

/**
 * Windows best first for an Agent of `sessionId`: its thread on screen, then focus, then visibility, then recency.
 */
const ranked = (windows: readonly KnownWindow[], sessionId: string | undefined): readonly KnownWindow[] => {
  const score = (window: KnownWindow): number =>
    (sessionId !== undefined && window.sessionId === sessionId ? 4 : 0) + (window.focused ? 2 : 0) + (window.visible ? 1 : 0)
  return [...windows].sort((left, right) => score(right) - score(left) || right.lastActiveAt - left.lastActiveAt)
}

/**
 * The window a call runs in: the one named, else the best-ranked window offering the tool.
 * @param input - the live windows, the caller's thread, the tool and an optional window id.
 * @returns the window, or why none fits.
 */
const pick = (input: {
  readonly windows: readonly KnownWindow[]
  readonly sessionId: string | undefined
  readonly tool: string
  readonly clientId: string | undefined
}): PickResult => {
  if (input.clientId !== undefined) {
    const named = input.windows.find(window => window.clientId === input.clientId)
    if (named === undefined) return { kind: 'unknown-window', clientId: input.clientId }
    return named.tools.some(tool => tool.name === input.tool) ? { kind: 'picked', window: named } : { kind: 'unknown-tool', window: named }
  }
  const order = ranked(input.windows, input.sessionId)
  const first = order[0]
  if (first === undefined) return { kind: 'no-window' }
  const offering = order.find(window => window.tools.some(tool => tool.name === input.tool))
  return offering === undefined ? { kind: 'unknown-tool', window: first } : { kind: 'picked', window: offering }
}

/** What an Agent reads of each window, best first. */
const view = (windows: readonly KnownWindow[], sessionId: string | undefined): readonly WindowView[] =>
  ranked(windows, sessionId).map(window => ({
    clientId: window.clientId,
    label: window.label,
    focused: window.focused,
    visible: window.visible,
    sessionId: window.sessionId,
    showsYourThread: sessionId !== undefined && window.sessionId === sessionId,
    lastActiveAt: window.lastActiveAt,
    tools: window.tools,
  }))

export class BridgeWindows {
  static readonly announce = announce
  static readonly live = live
  static readonly ranked = ranked
  static readonly pick = pick
  static readonly view = view
}
