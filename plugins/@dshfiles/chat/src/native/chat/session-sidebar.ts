/** Opens a conversation's links in the right Sidebar on behalf of that conversation's own Session. */
import type { ISidebarRight, SidebarRightOpenResourceOptions, SidebarRightOpenTabOptions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * `@dshfiles/sidebar-right` adds these: with no Session on screen (a Workbench thread
 * panel the native selection does not name) they open in the caller's Session
 * instead of failing. The stock owner lacks them and keeps `openResource`.
 */
interface SessionOwnedSidebar extends ISidebarRight {
  readonly openResourceFor?: (sessionId: SessionId, address: string, options?: SidebarRightOpenResourceOptions) => void
  readonly openTabFor?: <K extends string>(sessionId: SessionId, kind: K, options?: SidebarRightOpenTabOptions<K>) => void
}

/**
 * Bind the Sidebar's opens to one conversation's Session.
 * @param sidebar - the right Sidebar face in force.
 * @param sessionId - the conversation whose links are opened.
 * @returns resource and page opens for that conversation.
 */
export const sessionSidebar = (sidebar: SessionOwnedSidebar, sessionId: SessionId) => ({
  openResource: (address: string, options?: SidebarRightOpenResourceOptions): void => {
    if (sidebar.openResourceFor === undefined) sidebar.openResource(address, options)
    else sidebar.openResourceFor(sessionId, address, options)
  },
  openTab: <K extends string>(kind: K, options?: SidebarRightOpenTabOptions<K>): void => {
    if (sidebar.openTabFor === undefined) sidebar.openTab(kind, options)
    else sidebar.openTabFor(sessionId, kind, options)
  },
})
