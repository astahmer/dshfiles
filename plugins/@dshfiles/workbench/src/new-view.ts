import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from 'dockview-react'
import * as Schema from 'effect/Schema'
import { WORKBENCH_COMPONENT } from './layout-store.js'

const NEW_VIEW_PREFIX = 'dshfiles-workbench.new-view/'
const sourceParams = Schema.Struct({ sourceId: Schema.String.check(Schema.isMinLength(1)) })
const isSourceParams = Schema.is(sourceParams)
/** Saved with the layout, so a stand-in restored beside a view is still known as one. */
const PLACEHOLDER_PARAMS = { placeholder: true } as const
const isPlaceholderParams = Schema.is(Schema.Struct({ placeholder: Schema.Literal(true) }))

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
  // oxlint-disable-next-line antislop/no-unknown-parameters -- Dockview persistence is the input boundary; the guard validates it immediately below.
  static sourceId(params: unknown, fallback: string): string {
    // Most panels carry no source parameters: a guard answers without building a decode error per panel.
    return isSourceParams(params) ? params.sourceId : fallback
  }

  static open(api: DockviewApi, group?: DockviewGroupPanel, direction: 'within' | 'right' | 'below' = 'within'): IDockviewPanel {
    const options = { id: `${NEW_VIEW_PREFIX}${randomUUID()}`, title: 'New tab', component: WORKBENCH_COMPONENT }
    return group === undefined ? api.addPanel(options) : api.addPanel({ ...options, position: { referenceGroup: group, direction } })
  }

  /**
   * The chooser an empty pane opens for itself, so the pane is never blank. Unlike a chooser the user opened with
   * "+", it is only a stand-in: it goes away as soon as a real view is seated beside it.
   */
  static openPlaceholder(api: DockviewApi): IDockviewPanel {
    return api.addPanel({ id: `${NEW_VIEW_PREFIX}${randomUUID()}`, title: 'New tab', component: WORKBENCH_COMPONENT, params: PLACEHOLDER_PARAMS })
  }

  /** Close every stand-in chooser of a pane that now shows something else; returns whether one was closed. */
  static dropPlaceholders(api: DockviewApi): boolean {
    if (api.panels.length < 2) return false
    const placeholders = api.panels.filter(panel => NewViewTabs.isChooser(panel.id) && isPlaceholderParams(panel.params))
    // Two stand-ins and nothing else never happens; were it to, one stays so the pane is not left blank.
    const closing = placeholders.length === api.panels.length ? placeholders.slice(1) : placeholders
    for (const panel of closing) panel.api.close()
    return closing.length > 0
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
