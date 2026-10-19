import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { z } from 'zod'
import type { WorkbenchPanelDefinition } from './registry.js'

/** Every docked panel uses this one Dockview component; the panel id names the registry entry it renders. */
export const WORKBENCH_COMPONENT = 'workbench-panel'

const LAYOUT_STORAGE_KEYS = {
  main: 'dshfiles.workbench.layout.v1',
  'side-panel': 'dshfiles.workbench.side-panel-layout.v1',
  dock: 'dshfiles.workbench.dock-layout.v1',
  bottom: 'dshfiles.workbench.bottom-layout.v1',
} as const

const serializedPanelSchema = z.looseObject({ id: z.string(), contentComponent: z.literal(WORKBENCH_COMPONENT), title: z.string().optional() })

const serializedDockviewSchema = z.looseObject({
  grid: z.looseObject({ root: z.looseObject({ type: z.string() }), width: z.number(), height: z.number(), orientation: z.string() }),
  panels: z.record(z.string(), serializedPanelSchema),
})

/** The outer shape Dockview reads; anything deeper that it rejects makes `restoreLayout` fall back to the default. */
export const layoutSchema = z.custom<SerializedDockview>(value => serializedDockviewSchema.safeParse(value).success)

/** The regions a saved layout can carry, in the order the surfaces mount. */
export const LAYOUT_SURFACES = ['main', 'dock', 'bottom'] as const

export type LayoutSurface = (typeof LAYOUT_SURFACES)[number]

/** Every region keeps its own layout, so docking in one never rearranges another. */
export const createLayoutStore = (options?: {
  readonly surface?: keyof typeof LAYOUT_STORAGE_KEYS
  readonly storage?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
}) => createStoredValue({ key: LAYOUT_STORAGE_KEYS[options?.surface ?? 'main'], schema: layoutSchema, fallback: null, storage: options?.storage })

export type LayoutStore = ReturnType<typeof createLayoutStore>

const openPanel = (api: DockviewApi, definition: Pick<WorkbenchPanelDefinition, 'id' | 'title'>): void => {
  const existing = api.getPanel(definition.id)
  if (existing !== undefined) {
    existing.api.setActive()
    return
  }
  api.addPanel({ id: definition.id, component: WORKBENCH_COMPONENT, title: definition.title })
}

/** The Editor's panel id: the workbench exists to host it, so it opens alone when it is registered. */
const EDITOR_PANEL_ID = 'dshfiles-editor.main'

/**
 * The Editor alone when registered; otherwise the first two panels side by side
 * and the rest as tabs of the first group. In the dock the panel a contributor
 * marked `dockDefault` leads instead, so the persistent side panel opens on the
 * panel it exists for.
 */
const applyDefaultLayout = (api: DockviewApi, panels: readonly WorkbenchPanelDefinition[], preferDockDefault = false): void => {
  api.clear()
  const preferred = (preferDockDefault ? panels.find(panel => panel.dockDefault === true) : undefined) ?? panels.find(panel => panel.id === EDITOR_PANEL_ID)
  if (preferred !== undefined) {
    api.addPanel({ id: preferred.id, component: WORKBENCH_COMPONENT, title: preferred.title }).api.setActive()
    return
  }
  const [first, second, ...rest] = panels
  if (first === undefined) return
  const firstPanel = api.addPanel({ id: first.id, component: WORKBENCH_COMPONENT, title: first.title })
  if (second !== undefined) {
    api.addPanel({ id: second.id, component: WORKBENCH_COMPONENT, title: second.title, position: { referencePanel: firstPanel, direction: 'right' } })
  }
  for (const panel of rest) api.addPanel({ id: panel.id, component: WORKBENCH_COMPONENT, title: panel.title, position: { referencePanel: firstPanel } })
  firstPanel.api.setActive()
}

/** Restores the saved layout; a missing or unreadable one is cleared and replaced by the default. */
const restoreLayout = (
  api: DockviewApi,
  store: LayoutStore,
  panels: readonly WorkbenchPanelDefinition[],
  preferDockDefault = false,
): 'restored' | 'default' => {
  const saved = store.get()
  if (saved !== null) {
    try {
      api.fromJSON(saved)
      return 'restored'
    } catch {
      store.remove()
    }
  }
  applyDefaultLayout(api, panels, preferDockDefault)
  return 'default'
}

export class WorkbenchLayout {
  static readonly openPanel = openPanel
  static readonly applyDefaultLayout = applyDefaultLayout
  static readonly restoreLayout = restoreLayout
}
