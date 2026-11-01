import type { DockviewApi, SerializedDockview } from 'dockview-react'
import * as Schema from 'effect/Schema'
import type { NestedSurfacePath } from './dock-regions.js'
import { createEffectStoredValue } from './effect-stored-value.js'
import type { WorkbenchPanelDefinition } from './registry.js'

/** Every docked panel uses this one Dockview component; the panel id names the registry entry it renders. */
export const WORKBENCH_COMPONENT = 'workbench-panel'

const LAYOUT_STORAGE_KEYS = {
  main: 'dshfiles.workbench.layout.v1',
  left: 'dshfiles.workbench.left-layout.v1',
  'side-panel': 'dshfiles.workbench.side-panel-layout.v1',
  dock: 'dshfiles.workbench.dock-layout.v1',
  bottom: 'dshfiles.workbench.bottom-layout.v1',
} as const

const serializedPanelSchema = Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, contentComponent: Schema.Literal(WORKBENCH_COMPONENT), title: Schema.optionalKey(Schema.String) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const serializedDockviewSchema = Schema.StructWithRest(
  Schema.Struct({
    grid: Schema.StructWithRest(
      Schema.Struct({
        root: Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [Schema.Record(Schema.String, Schema.Unknown)]),
        width: Schema.Number.check(Schema.isFinite()),
        height: Schema.Number.check(Schema.isFinite()),
        orientation: Schema.String,
      }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
    panels: Schema.Record(Schema.String, serializedPanelSchema),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

/** The outer shape Dockview reads; anything deeper that it rejects makes `restoreLayout` fall back to the default. */
export const layoutSchema = Schema.declare<SerializedDockview>(
  (value): value is SerializedDockview => Schema.decodeUnknownResult(serializedDockviewSchema)(value)._tag === 'Success',
)

export const decodeLayout = (value: unknown): SerializedDockview => Schema.decodeUnknownSync(layoutSchema)(value)

/** The regions a saved layout can carry, in the order the surfaces mount. */
export const LAYOUT_SURFACES = ['main', 'left', 'dock', 'bottom'] as const

export type LayoutSurface = (typeof LAYOUT_SURFACES)[number]

/** Root keys remain unchanged; nested surfaces use their immutable container path. */
export type LayoutStoreSurface = keyof typeof LAYOUT_STORAGE_KEYS | NestedSurfacePath

type LayoutStorage = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null

/** Shared validation for persisted nested identities and named nested layouts. */
export const nestedSurfacePathSchema = Schema.TemplateLiteral(['nested/', Schema.String]).check(
  Schema.isPattern(/^nested\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/u),
)

const decodeNestedSurfacePath = (value: string): NestedSurfacePath => Schema.decodeUnknownSync(nestedSurfacePathSchema)(value)
export { decodeNestedSurfacePath }

const surfaceStorageKey = (surface: LayoutStoreSurface): string => {
  if (surface === 'main' || surface === 'left' || surface === 'side-panel' || surface === 'dock' || surface === 'bottom') return LAYOUT_STORAGE_KEYS[surface]
  return `dshfiles.workbench.nested-layout.v1:${decodeNestedSurfacePath(surface)}`
}

type LayoutStoreOptions = { surface?: LayoutStoreSurface; storage?: LayoutStorage }

/** Every region keeps its own layout, so docking in one never rearranges another. */
export const createLayoutStore = (options?: Readonly<LayoutStoreOptions>) =>
  createEffectStoredValue({ key: surfaceStorageKey(options?.surface ?? 'main'), schema: layoutSchema, fallback: null, storage: options?.storage })

export type LayoutStore = ReturnType<typeof createLayoutStore>
export type NestedLayouts = Record<NestedSurfacePath, SerializedDockview | null>
const NO_NESTED_PATHS: NestedSurfacePath[] = []

/**
 * A persisted path index makes closed/unmounted nested surfaces part of named
 * layouts too. Store objects are shared while live so restoring a named layout
 * notifies an already-mounted surface through its existing subscription.
 */
export const createNestedLayoutStores = (options?: { readonly storage?: LayoutStorage }) => {
  const paths = createEffectStoredValue({
    key: 'dshfiles.workbench.nested-paths.v1',
    schema: Schema.Array(nestedSurfacePathSchema),
    fallback: NO_NESTED_PATHS,
    storage: options?.storage,
  })
  const stores = new Map<NestedSurfacePath, LayoutStore>()
  const store = (path: NestedSurfacePath): LayoutStore => {
    decodeNestedSurfacePath(path)
    if (!paths.get().includes(path)) paths.set([...paths.get(), path])
    let existing = stores.get(path)
    if (existing === undefined) {
      const storeOptions: LayoutStoreOptions = { surface: path }
      if (options?.storage !== undefined) storeOptions.storage = options.storage
      existing = createLayoutStore(storeOptions)
      stores.set(path, existing)
    }
    return existing
  }
  return {
    store,
    paths: (): readonly NestedSurfacePath[] => paths.get(),
    capture: (): NestedLayouts => Object.fromEntries(paths.get().map(path => [path, store(path).get()])),
    restore: (layouts: Readonly<NestedLayouts>): void => {
      for (const [path, layout] of Object.entries(layouts)) {
        const target = store(decodeNestedSurfacePath(path))
        if (layout === null) target.remove()
        else if (layout !== undefined) target.set(layout)
      }
    },
  }
}

export type NestedLayoutStores = ReturnType<typeof createNestedLayoutStores>
export const nestedLayoutStores = createNestedLayoutStores()

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

/** What a surface shows when it has no saved layout of its own. */
export type WorkbenchDefaultLayout = 'editor' | 'dock-default' | 'empty' | 'conversation' | 'threads'

/**
 * The Editor alone when registered; otherwise the first two panels side by side
 * and the rest as tabs of the first group. In the dock the panel a contributor
 * marked `dockDefault` leads instead, so the persistent side panel opens on the
 * panel it exists for. The bottom row opens empty: a panel lives in exactly one
 * region, so it waits for one to be dragged or moved into it rather than
 * duplicating one another region already shows.
 */
const applyDefaultLayout = (
  api: Pick<DockviewApi, 'clear' | 'addPanel'>,
  panels: readonly WorkbenchPanelDefinition[],
  defaultLayout: WorkbenchDefaultLayout = 'editor',
): void => {
  api.clear()
  if (defaultLayout === 'empty') return
  if (defaultLayout === 'threads') {
    const threads = panels.find(panel => panel.id === 'dshfiles-thread-sidebar.workbench-threads')
    const navigation = panels.find(panel => panel.id === 'dshfiles-thread-sidebar.workbench-navigation')
    if (threads === undefined) return
    const threadPanel = api.addPanel({ id: threads.id, component: WORKBENCH_COMPONENT, title: threads.title })
    if (navigation !== undefined)
      api.addPanel({
        id: navigation.id,
        component: WORKBENCH_COMPONENT,
        title: navigation.title,
        position: { referencePanel: threadPanel, direction: 'above' },
        initialHeight: 160,
      })
    threadPanel.api.setActive()
    return
  }
  const preferred =
    defaultLayout === 'conversation'
      ? panels.find(panel => panel.id === 'conversation')
      : ((defaultLayout === 'dock-default' ? panels.find(panel => panel.dockDefault === true) : undefined) ??
        panels.find(panel => panel.id === EDITOR_PANEL_ID))
  if (preferred !== undefined) {
    api.addPanel({ id: preferred.id, component: WORKBENCH_COMPONENT, title: preferred.title }).api.setActive()
    return
  }
  const [first, second, ...rest] = panels.filter(panel => !panel.hiddenFromAdd && panel.tabId === undefined)
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
  defaultLayout: WorkbenchDefaultLayout = 'editor',
): 'restored' | 'default' => {
  const saved = store.get()
  if (saved !== null) {
    try {
      api.fromJSON(saved)
      // A pre-main-seat layout retains every panel and gains the conversation
      // only when its caller explicitly opts into the main conversation default.
      if (defaultLayout === 'conversation' && api.getPanel('conversation') === undefined) {
        const conversation = panels.find(panel => panel.id === 'conversation')
        if (conversation !== undefined) api.addPanel({ id: conversation.id, component: WORKBENCH_COMPONENT, title: conversation.title, inactive: true })
      }
      return 'restored'
    } catch {
      store.remove()
    }
  }
  applyDefaultLayout(api, panels, defaultLayout)
  return 'default'
}

export class WorkbenchLayout {
  static readonly openPanel = openPanel
  static readonly applyDefaultLayout = applyDefaultLayout
  static readonly restoreLayout = restoreLayout
}
