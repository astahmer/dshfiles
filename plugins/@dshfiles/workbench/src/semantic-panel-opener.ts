import type { WorkbenchRegionId } from './dock-regions.js'
import { tabPanelId } from './tab-panels.js'
import type { WorkbenchTabsProvider } from './tabs.js'

/** One-shot placement intents; the existing tab provider still owns navigation and tab identity. */
export const createSemanticPanelOpener = (ports: {
  readonly tabs: () => WorkbenchTabsProvider
  readonly registered: (panelId: string) => boolean
  readonly savedRegionOf: (panelId: string) => WorkbenchRegionId | undefined
  readonly openInRegion: (region: WorkbenchRegionId, panelId: string) => void
}) => {
  const requested = new Map<string, { readonly scopeKey: string; readonly region: WorkbenchRegionId }>()
  const place = (panelId: string): void => {
    const snapshot = ports.tabs().getSnapshot()
    const intent = requested.get(panelId)
    requested.delete(panelId)
    const region = snapshot.enabled && intent?.scopeKey === snapshot.scopeKey ? intent.region : (ports.savedRegionOf(panelId) ?? 'main')
    ports.openInRegion(region, panelId)
  }
  return {
    place,
    request: (region: WorkbenchRegionId, panelId: string, title: string): void => {
      const tabs = ports.tabs()
      const snapshot = tabs.getSnapshot()
      if (!snapshot.enabled) return
      const id = tabPanelId(`panel:${panelId}`)
      // A scope change invalidates delayed intents from the previous tab set.
      for (const [key, intent] of requested) if (intent.scopeKey !== snapshot.scopeKey) requested.delete(key)
      requested.set(id, { scopeKey: snapshot.scopeKey, region })
      // Reopening an existing actor tab may publish no metadata change at all.
      if (ports.registered(id)) place(id)
      tabs.actions.open({ kind: 'panel', panelId }, true, title)
    },
  }
}
