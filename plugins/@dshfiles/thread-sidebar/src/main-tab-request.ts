/**
 * `@dshfiles/main-tabs` takes this cancelable window event to open a thread in the main view; a handled dispatch comes
 * back cancelled, so the side panel only closes its tab once the main strip actually took the thread.
 */
export const OPEN_THREAD_IN_MAIN_TAB_EVENT = 'dshfiles:open-thread'

/** Ask the main tab strip for one thread's tab; false leaves the thread where it is. */
export const requestThreadMainTab = (sessionId: string, newTab = true): boolean =>
  !window.dispatchEvent(new CustomEvent(OPEN_THREAD_IN_MAIN_TAB_EVENT, { detail: { sessionId, newTab }, cancelable: true }))

/** The sidebar's ordinary open boundary; native navigation remains the fallback owner. */
export const openThreadInMain = <Id extends string>(sessionId: Id, openSession: (sessionId: Id) => void): void => {
  // The native current Session may already be this one after every visible tab
  // was closed. Explicit open intent must reach the tab owner even without a
  // native selection change. Ordinary opens still obey standalone preview policy.
  if (!requestThreadMainTab(sessionId, false)) openSession(sessionId)
}
