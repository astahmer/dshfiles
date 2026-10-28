import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'
import { NewViewTabs } from './new-view.js'

/** The permanent centre is the root grid, not every floating/popout group in its API. */
export class MainSurfaceGuard {
  static groups(api: Pick<DockviewApi, 'groups'>): readonly DockviewGroupPanel[] {
    return api.groups.filter(group => group.api.location.type === 'grid')
  }

  /** Keep the centre reachable without closing or reconstructing any live resource. */
  static retain(api: DockviewApi): () => void {
    let repairing = false
    const repair = (): void => {
      if (repairing) return
      repairing = true
      try {
        const groups = MainSurfaceGuard.groups(api)
        // A populated one-tab group may deliberately hide its row. The row
        // policy and content recovery control own that choice; root safety only
        // ensures that a docked group exists, never overrides its presentation.
        if (groups.some(group => group.panels.length > 0)) return
        // Bare addPanel follows the active group, which can itself be floating.
        const active = api.activePanel
        NewViewTabs.open(api, groups[0] ?? api.addGroup())
        if (active !== undefined && active.group.api.location.type !== 'grid') active.api.setActive()
      } finally {
        repairing = false
      }
    }
    // A move/float temporarily removes groups; repair only after the complete
    // structural mutation, never halfway through removal or resource transfer.
    const mutation = api.onDidMutateLayout(repair)
    const layout = api.onDidLayoutChange(repair)
    repair()
    return () => {
      mutation.dispose()
      layout.dispose()
    }
  }
}
