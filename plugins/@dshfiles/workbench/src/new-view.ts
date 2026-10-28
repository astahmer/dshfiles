import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from 'dockview-react'
import { z } from 'zod'
import { WORKBENCH_COMPONENT } from './layout-store.js'

const NEW_VIEW_PREFIX = 'dshfiles-workbench.new-view/'
const sourceParams = z.object({ sourceId: z.string().min(1) })

export interface NewViewSelection {
  readonly group?: DockviewGroupPanel
  readonly replacePanelId?: string
}

/** Chooser presentation and persisted source identities; never owns a resource or semantic actor. */
export class NewViewTabs {
  static isChooser(id: string): boolean {
    return id.startsWith(NEW_VIEW_PREFIX)
  }

  /** Validate source parameters where Dockview restores untrusted browser layout data. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- Dockview persistence is the input boundary; safeParse validates it immediately below.
  static sourceId(params: unknown, fallback: string): string {
    const parsed = sourceParams.safeParse(params)
    return parsed.success ? parsed.data.sourceId : fallback
  }

  static open(api: DockviewApi, group?: DockviewGroupPanel, direction: 'within' | 'right' | 'below' = 'within'): IDockviewPanel {
    const options = { id: `${NEW_VIEW_PREFIX}${crypto.randomUUID()}`, title: 'New tab', component: WORKBENCH_COMPONENT }
    return group === undefined ? api.addPanel(options) : api.addPanel({ ...options, position: { referenceGroup: group, direction } })
  }

  /** Successful adoption closes only its chooser, never the real resource callback. */
  static completeSelection(api: DockviewApi, panelId: string, target: NewViewSelection): boolean {
    const panel = api.getPanel(panelId)
    if (panel === undefined) return false
    const chooser = target.replacePanelId === undefined ? undefined : api.getPanel(target.replacePanelId)
    const group = chooser?.group ?? target.group
    if (group !== undefined && api.groups.includes(group) && panel.group !== group) panel.api.moveTo({ group, position: 'center' })
    panel.api.setActive()
    chooser?.api.close()
    return true
  }
}
