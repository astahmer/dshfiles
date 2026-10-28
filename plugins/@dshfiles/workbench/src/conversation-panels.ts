import type { DockviewApi } from 'dockview-react'
import { NewViewTabs } from './new-view.js'
import type { WorkbenchTabsSnapshot } from './tabs.js'
import { tabPanelId } from './tab-panels.js'

/** Compatibility identities are not independent conversation resources. */
export class ConversationPanels {
  /** A not-yet-materialized New thread still needs its native workspace/input UI. */
  static blank(snapshot: WorkbenchTabsSnapshot): boolean {
    // Every materialized Session, including a blank draft, belongs to the tab
    // actor. Its absence from tabs can mean the user closed it; never resurrect it.
    return snapshot.currentSessionId === undefined && snapshot.tabs.length === 0
  }

  static legacy(source: string): boolean {
    return source === 'conversation' || source === 'current-conversation' || source === 'main/conversation'
  }

  /** Retire global-following aliases, never semantic Session-bound tabs. */
  static reconcile(input: {
    readonly snapshot: WorkbenchTabsSnapshot
    readonly blank: boolean
    readonly surfaces: readonly DockviewApi[]
    readonly openBlank: () => void
  }): void {
    if (!input.snapshot.enabled) return
    let hasBlank = false
    let retiredActive = false
    for (const api of input.surfaces)
      for (const panel of [...api.panels]) {
        if (!ConversationPanels.legacy(NewViewTabs.sourceId(panel.toJSON().params, panel.id))) continue
        if (input.blank && panel.id === 'conversation' && !hasBlank) {
          hasBlank = true
          continue
        }
        // removePanel retires presentation without generating a user close or
        // navigating to its automatic neighbour. The permanent grid owns recovery.
        retiredActive ||= api.activePanel === panel
        api.removePanel(panel)
      }
    // A closed last tab is not a request to resurrect the native current Session.
    // Only an unmaterialized New thread owns the native draft fallback.
    if (input.blank && !hasBlank) input.openBlank()
    if (retiredActive && !input.blank && input.snapshot.activeTabId !== null)
      for (const api of input.surfaces) api.getPanel(tabPanelId(input.snapshot.activeTabId))?.api.setActive()
  }
}
