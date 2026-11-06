/**
 * One deep-link request from the URL to the thread list: a page-load route waits for the list to become ready, a Back or
 * Forward navigation replaces whichever request was waiting, and the thread it opens writes the URL back only once the
 * request is settled. The union keeps "waiting for the list" and "URL write suppressed" from existing at once.
 */
export type ThreadRouteSource = 'page-load' | 'popstate'

export type ThreadRouteState =
  | { readonly status: 'idle'; readonly suppressedSessionId: string | null }
  | { readonly status: 'pending'; readonly sessionId: string; readonly source: ThreadRouteSource }
  | { readonly status: 'opening'; readonly sessionId: string }

export type ThreadRouteEvent =
  /** Browser Back/Forward landed on a URL with or without a thread. */
  | { readonly type: 'navigate'; readonly sessionId: string | null; readonly selectedSessionId: string | null }
  /** The user picked a thread, which is the request the URL now describes. */
  | { readonly type: 'select' }
  /** The route resolved to a thread the list is about to open. */
  | { readonly type: 'open' }
  | { readonly type: 'settle'; readonly selectedSessionId: string | null }
  /** The route names a Session this Host does not list. */
  | { readonly type: 'missing' }
  | { readonly type: 'clear-suppression' }

export const initialThreadRoute = (pageLoadSessionId: string | null): ThreadRouteState =>
  pageLoadSessionId === null ? { status: 'idle', suppressedSessionId: null } : { status: 'pending', sessionId: pageLoadSessionId, source: 'page-load' }

export const reduceThreadRoute = (state: ThreadRouteState, event: ThreadRouteEvent): ThreadRouteState => {
  switch (event.type) {
    case 'navigate':
      return event.sessionId === null
        ? { status: 'idle', suppressedSessionId: event.selectedSessionId }
        : { status: 'pending', sessionId: event.sessionId, source: 'popstate' }
    case 'select':
      return state.status === 'idle' && state.suppressedSessionId === null ? state : { status: 'idle', suppressedSessionId: null }
    case 'open':
      return state.status === 'pending' ? { status: 'opening', sessionId: state.sessionId } : state
    case 'settle':
      return state.status !== 'idle' && state.sessionId === event.selectedSessionId ? { status: 'idle', suppressedSessionId: null } : state
    case 'missing':
      return state.status === 'idle' ? state : { status: 'idle', suppressedSessionId: null }
    case 'clear-suppression':
      return state.status === 'idle' && state.suppressedSessionId !== null ? { status: 'idle', suppressedSessionId: null } : state
  }
}

/** The request a ready thread list must resolve, or null once it is opening or settled. */
export const pendingThreadRoute = (state: ThreadRouteState): { readonly sessionId: string; readonly source: ThreadRouteSource } | null =>
  state.status === 'pending' ? { sessionId: state.sessionId, source: state.source } : null

export interface ThreadUrlRoute {
  /** The thread the URL should name now; null while a request is unresolved or while its write stays suppressed. */
  readonly sessionId: string | null
  /** The held-back write belongs to a session the user already left, so it must not silence the next write. */
  readonly suppressionStale: boolean
}

export const threadUrlRoute = (input: { readonly state: ThreadRouteState; readonly selectedSessionId: string | null }): ThreadUrlRoute => {
  if (input.state.status !== 'idle') return { sessionId: null, suppressionStale: false }
  const suppressedSessionId = input.state.suppressedSessionId
  if (suppressedSessionId === null) return { sessionId: input.selectedSessionId, suppressionStale: false }
  const suppressionStale = suppressedSessionId !== input.selectedSessionId
  return { sessionId: suppressionStale ? input.selectedSessionId : null, suppressionStale }
}
