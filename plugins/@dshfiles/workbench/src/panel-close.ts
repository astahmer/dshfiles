import type { DockviewApi } from 'dockview-react'
import { NewViewTabs } from './new-view.js'
import type { WorkbenchPanelRegistry } from './registry.js'

/** One panel's surviving presentation, named the way Dockview restored or added it. */
export interface WorkbenchPanelIdentity {
  readonly id: string
  readonly params: unknown
}

/**
 * Close one panel through its owning registration, then retire the presentation
 * it left behind.
 *
 * The semantic or native owner may already have retired this occurrence, so the
 * second step retires only the exact panel that still exists. It removes the
 * presentation instead of calling `panel.api.close()`, because Dockview reports
 * that call's automatic neighbour activation as user input and would navigate
 * the tab actor back.
 */
export const closeWorkbenchPanel = (input: { api: DockviewApi; registry: WorkbenchPanelRegistry; panel: WorkbenchPanelIdentity }): void => {
  input.registry.get(NewViewTabs.sourceId(input.panel.params, input.panel.id))?.beforeClose?.()
  const panel = input.api.getPanel(input.panel.id)
  if (panel !== undefined) input.api.removePanel(panel)
}
