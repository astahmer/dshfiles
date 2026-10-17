export interface ThreadRoute {
  sessionId: string
  workspaceId?: string
}

export class ThreadUrlModel {
  private static readonly threadUrlParam = 'thread'
  private static readonly workspaceUrlParam = 'workspace'

  /**
   * Build a same-origin deep link while dropping transient query and fragment
   * data (including launch credentials) from the copied address.
   */
  static readonly buildThreadUrl = (currentUrl: string, sessionId: string, workspaceId?: string): string => {
    const url = new URL(currentUrl)
    url.search = ''
    url.hash = ''
    url.searchParams.set(ThreadUrlModel.threadUrlParam, sessionId)
    if (workspaceId !== undefined && workspaceId.length > 0) {
      url.searchParams.set(ThreadUrlModel.workspaceUrlParam, workspaceId)
    }
    return url.toString()
  }

  /** Read the optional thread route from the current root/index URL. */
  static readonly readThreadUrl = (currentUrl: string): ThreadRoute | undefined => {
    const url = new URL(currentUrl)
    const sessionId = url.searchParams.get(ThreadUrlModel.threadUrlParam)
    if (sessionId === null || sessionId.length === 0) return undefined
    const workspaceId = url.searchParams.get(ThreadUrlModel.workspaceUrlParam)
    if (workspaceId === null || workspaceId.length === 0) return { sessionId }
    return { sessionId, workspaceId }
  }

  /** Remove the thread route after a link points to a session absent on this Host. */
  static readonly clearThreadUrl = (currentUrl: string): string => {
    const url = new URL(currentUrl)
    url.searchParams.delete(ThreadUrlModel.threadUrlParam)
    url.searchParams.delete(ThreadUrlModel.workspaceUrlParam)
    return url.toString()
  }
}
export const buildThreadUrl = ThreadUrlModel.buildThreadUrl
export const clearThreadUrl = ThreadUrlModel.clearThreadUrl
export const readThreadUrl = ThreadUrlModel.readThreadUrl
