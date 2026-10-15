export type ThreadSidebarModelRoute = string | null

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    threadSidebarModelRoute: ThreadSidebarModelRoute
  }

  interface SessionProjectionStateMap {
    threadSidebarModelRoute: ThreadSidebarModelRoute
  }
}
