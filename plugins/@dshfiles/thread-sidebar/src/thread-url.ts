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
/**
 * The `?thread=` route the page was loaded with, offered until one thread list resolves it. The thread list unmounts
 * while the rail shows another destination and the URL then keeps the thread it last wrote, so a remount must not read
 * that stale URL as a request to navigate: it would pull the stage away from a thread opened meanwhile (New thread on
 * the Settings destination). Back and Forward still route through `popstate`.
 */
export class PageLoadThreadRoute {
  private settled = false

  /** The page-load route while unresolved; null once a list resolved it or the page had none. */
  readonly pending = (currentUrl: string): string | null => {
    if (this.settled) return null
    const sessionId = ThreadUrlModel.readThreadUrl(currentUrl)?.sessionId ?? null
    // A page loaded without a route has nothing to resolve: a URL written later by the list is never a request.
    if (sessionId === null) this.settled = true
    return sessionId
  }

  /** Called once the route was opened, found already selected, reported missing or overtaken by a user selection. */
  readonly settle = (): void => {
    this.settled = true
  }
}

/** One per page: each plugin bundle loads this module once. */
export const pageLoadThreadRoute = new PageLoadThreadRoute()

export const buildThreadUrl = ThreadUrlModel.buildThreadUrl
export const clearThreadUrl = ThreadUrlModel.clearThreadUrl
export const readThreadUrl = ThreadUrlModel.readThreadUrl
