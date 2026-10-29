import type { DockviewApi } from 'dockview-react'
import type { NewViewSelection } from './new-view.js'
import type { WorkbenchPanelDefinition } from './registry.js'
import { tabPanelId } from './tab-panels.js'
import { workbenchTabs } from './tabs.js'

/**
 * A chooser launcher for the tabs provider's New thread. The provider owns the
 * Session and its semantic tab; this source only seats that tab where it was asked.
 */
export class NewThreadSource {
  static readonly id = 'dshfiles-workbench.new-thread'

  static create(seat: (api: DockviewApi, panelId: string, selection: NewViewSelection) => void) {
    let pending:
      | { readonly api: DockviewApi; readonly selection: NewViewSelection; readonly scopeKey: string; readonly knownTabIds: ReadonlySet<string> }
      | undefined
    const definition: WorkbenchPanelDefinition = { id: NewThreadSource.id, title: 'New thread', component: () => null }
    return {
      definition,
      open: (source: WorkbenchPanelDefinition, api: DockviewApi, selection: NewViewSelection = {}): boolean => {
        if (source.id !== NewThreadSource.id) return false
        const tabs = workbenchTabs()
        const snapshot = tabs.getSnapshot()
        pending = { api, selection, scopeKey: snapshot.scopeKey, knownTabIds: new Set(snapshot.tabs.map(tab => tab.id)) }
        tabs.actions.newThread?.()
        return true
      },
      /** Run before default placement of a semantic tab occurrence. */
      admit: (panelId: string): boolean => {
        if (pending === undefined) return false
        const snapshot = workbenchTabs().getSnapshot()
        const tab = snapshot.tabs.find(candidate => tabPanelId(candidate.id) === panelId)
        if (tab?.target.kind !== 'thread' || pending.knownTabIds.has(tab.id)) return false
        const { api, selection, scopeKey } = pending
        pending = undefined
        if (scopeKey !== snapshot.scopeKey) return false
        seat(api, panelId, selection)
        return true
      },
      clear: (): void => {
        pending = undefined
      },
    }
  }
}
