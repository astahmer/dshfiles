/** Stable identity of the thread-aside tab type in the right sidebar's tab registry. */
export const THREAD_ASIDE_ID = '@dshfiles/thread-sidebar/aside'
/** The address type and tab kind one aside resource uses. */
export const THREAD_ASIDE_KIND = 'threadaside'
/** Slot hosting one aside's embedded Conversation. */
export const THREAD_ASIDE_CONVERSATION_SLOT = 'dshfiles.thread-sidebar.conversation'

const THREAD_ASIDE_ADDRESS = 'dsh-resource://threadaside/session/'

/** Address of the right-sidebar tab that hosts one thread's own Conversation. */
export const threadAsideAddress = (sessionId: string): string => `${THREAD_ASIDE_ADDRESS}${encodeURIComponent(sessionId)}`

/** The session an aside address names, or undefined for another or malformed resource. */
export const threadAsideSessionId = (address: string): string | undefined => {
  if (!address.startsWith(THREAD_ASIDE_ADDRESS)) return undefined
  try {
    return decodeURIComponent(address.slice(THREAD_ASIDE_ADDRESS.length)) || undefined
  } catch {
    return undefined
  }
}
