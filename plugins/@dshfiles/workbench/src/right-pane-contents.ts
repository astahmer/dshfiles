import { workbenchRegions } from './dock-regions.js'
import { NewViewTabs } from './new-view.js'
import { closeWorkbenchPanel } from './panel-close.js'
import type { WorkbenchPanelRegistry } from './registry.js'
import type { RightPaneContents } from './right-panel-mode.js'

export const createRightPaneContents = (registry: WorkbenchPanelRegistry): RightPaneContents => ({
  panels: () => workbenchRegions().get('right')?.panels ?? [],
  close: panel => {
    if (!NewViewTabs.isChooser(panel.id)) return
    const api = workbenchRegions().get('right')
    if (api?.getPanel(panel.id) === undefined) return
    closeWorkbenchPanel({ api, registry, panel })
  },
})
