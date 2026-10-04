/** Root-query route keys; DSH's static host has no pathname router. */
export const THREAD_URL_PARAM = 'thread'
export const WORKSPACE_URL_PARAM = 'workspace'

export interface ThreadRoute {
  sessionId: string
  workspaceId?: string
}

/**
 * Build a same-origin deep link while dropping transient query and fragment
 * data (including launch credentials) from the copied address.
 */
export const buildThreadUrl = (
  currentUrl: string,
  sessionId: string,
  workspaceId?: string,
): string => {
  const url = new URL(currentUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set(THREAD_URL_PARAM, sessionId)
  if (workspaceId !== undefined && workspaceId.length > 0) {
    url.searchParams.set(WORKSPACE_URL_PARAM, workspaceId)
  }
  return url.toString()
}

/** Read the optional thread route from the current root/index URL. */
export const readThreadUrl = (currentUrl: string): ThreadRoute | undefined => {
  const url = new URL(currentUrl)
  const sessionId = url.searchParams.get(THREAD_URL_PARAM)
  if (sessionId === null || sessionId.length === 0) return undefined
  const workspaceId = url.searchParams.get(WORKSPACE_URL_PARAM)
  return {
    sessionId,
    ...(workspaceId === null || workspaceId.length === 0 ? {} : { workspaceId }),
  }
}

/** Remove the thread route after a link points to a session absent on this Host. */
export const clearThreadUrl = (currentUrl: string): string => {
  const url = new URL(currentUrl)
  url.searchParams.delete(THREAD_URL_PARAM)
  url.searchParams.delete(WORKSPACE_URL_PARAM)
  return url.toString()
}
