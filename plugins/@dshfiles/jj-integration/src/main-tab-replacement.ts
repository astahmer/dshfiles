export const REPLACE_THREAD_TAB_EVENT = 'dshfiles:replace-thread-tab'

export const requestReplaceThreadTab = (sourceSessionId: string, sessionId: string): boolean =>
  !window.dispatchEvent(
    new CustomEvent(REPLACE_THREAD_TAB_EVENT, {
      detail: { sourceSessionId, sessionId },
      cancelable: true,
    }),
  )
