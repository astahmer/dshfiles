/**
 * `@dshfiles/main-tabs` takes this cancelable window event to open a thread in the main view; a handled dispatch comes
 * back cancelled, so the side panel only closes its tab once the main strip actually took the thread.
 */
export const OPEN_THREAD_IN_MAIN_TAB_EVENT = 'dshfiles:open-thread'

/** Ask the main tab strip for one thread's tab; false leaves the thread where it is. */
export const requestThreadMainTab = (sessionId: string): boolean =>
  !window.dispatchEvent(new CustomEvent(OPEN_THREAD_IN_MAIN_TAB_EVENT, { detail: { sessionId, newTab: true }, cancelable: true }))
