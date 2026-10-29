/**
 * Which surface one `ThreadSidebar` mount renders: the sidebar's list (the primary mount, which owns the automation
 * and global listeners) or the full-page board the sidebar's panel list opens in the main column.
 */
export type ThreadSidebarSurface = 'sidebar' | 'board'

/** The DOM attribute each surface marks its root with, so a global drag listener can tell whose row it is. */
const THREAD_SURFACE_ATTRIBUTE = 'data-thread-surface'

const isThreadSidebarSurface = (value: string | undefined): value is ThreadSidebarSurface => value === 'sidebar' || value === 'board'

/** The thread-list surface an element belongs to, or null for anything outside one (the composer, a dialog). */
export const threadSurfaceOf = (element: Element | null): ThreadSidebarSurface | null => {
  const value = element?.closest<HTMLElement>(`[${THREAD_SURFACE_ATTRIBUTE}]`)?.getAttribute(THREAD_SURFACE_ATTRIBUTE) ?? undefined
  return isThreadSidebarSurface(value) ? value : null
}
