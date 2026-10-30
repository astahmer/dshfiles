import type { IDockviewPanel } from 'dockview-react'
import { NewViewTabs } from './new-view.js'
import type { WorkbenchPanelRegistry } from './registry.js'

export const panelMainTarget = (input: {
  readonly panel: IDockviewPanel | undefined
  readonly registry: Pick<WorkbenchPanelRegistry, 'get'>
}): string | undefined => {
  if (input.panel === undefined) return undefined
  const sourceId = NewViewTabs.sourceId(input.panel.toJSON().params, input.panel.id)
  return input.registry.get(sourceId)?.mainPanelId
}
