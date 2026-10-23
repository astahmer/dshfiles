export const SETTLE_THREAD_EVENT = 'dshfiles:thread-settle'

/** Ask thread-sidebar to settle this thread; it owns the settled status. */
export const requestThreadSettle = (sessionId: string): boolean =>
  !window.dispatchEvent(new CustomEvent(SETTLE_THREAD_EVENT, { detail: { sessionId }, cancelable: true }))
