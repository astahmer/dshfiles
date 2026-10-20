/**
 * `@dshfiles/thread-sidebar` owns the settled status and answers this cancelable window event (its
 * `settle-request.ts`). The integration notice cannot write that status itself: a settled thread is a sidebar
 * setting, so the notice asks its owner, and a dispatch that comes back cancelled means the sidebar took it.
 */
export const SETTLE_THREAD_EVENT = 'dshfiles:thread-settle'

/** Ask the thread sidebar to settle one integrated thread; false when no sidebar answered. */
export const requestThreadSettle = (sessionId: string): boolean =>
  !window.dispatchEvent(new CustomEvent(SETTLE_THREAD_EVENT, { detail: { sessionId }, cancelable: true }))
