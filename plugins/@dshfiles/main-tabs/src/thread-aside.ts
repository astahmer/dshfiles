/**
 * `@dshfiles/thread-sidebar` owns the thread aside and answers this cancelable window event. A dispatch that comes
 * back cancelled means the side panel took the thread; an unanswered one means no plugin offers an aside here.
 */
export const OPEN_THREAD_ASIDE_EVENT = 'dshfiles:open-thread-aside'

/** Ask the side panel to show one thread; false leaves the thread alone. */
export const requestThreadAside = (sessionId: string): boolean =>
  !window.dispatchEvent(new CustomEvent(OPEN_THREAD_ASIDE_EVENT, { detail: { sessionId }, cancelable: true }))
