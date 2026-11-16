import { SidebarResourcePanelModel } from '@dshfiles/sidebar-right/resource-panels'

/** What a panel whose source is gone is called: its last title, never its id. */
export const lastKnownPanelTitle = (id: string, title: string | undefined): string | undefined => {
  const trimmed = title?.trim() ?? ''
  // Dockview falls back to the id when a panel was saved without a title.
  return trimmed === '' || trimmed === id || SidebarResourcePanelModel.sessionIdOf(trimmed) !== undefined ? undefined : trimmed
}

/**
 * Why a saved panel has no source: a thread page outlives its thread's record and never comes back, while any other
 * panel waits for its plugin to register again. The two get different sentences.
 */
export const missingPanelMessage = (id: string, title: string | undefined) => {
  const lastTitle = lastKnownPanelTitle(id, title)
  const threadPage = SidebarResourcePanelModel.sessionIdOf(id) !== undefined
  if (lastTitle === undefined) return { key: threadPage ? 'missingThreadPanel' : 'missingPanel' } as const
  return { key: threadPage ? 'missingThreadPanelNamed' : 'missingPanelNamed', params: { title: lastTitle } } as const
}
