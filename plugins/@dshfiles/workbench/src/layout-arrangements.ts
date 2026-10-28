import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { LAYOUT_SURFACES, nestedSurfacePathSchema, type LayoutStore, type LayoutSurface, type NestedLayoutStores } from './layout-store.js'
import { nestedPanelId } from './nested-surfaces.js'
import type { WorkbenchRegionId } from './dock-regions.js'
import type { SavedLayout } from './saved-layouts.js'

/** Only real layout capabilities cross this seam; it owns no stores or region state. */
export type ArrangementSurface = Pick<DockviewApi, 'toJSON' | 'fromJSON' | 'clear' | 'getPanel'>
export interface ArrangementRegions<Surface extends ArrangementSurface> {
  readonly get: (region: WorkbenchRegionId) => Surface | undefined
  readonly entries: () => readonly (readonly [WorkbenchRegionId, Surface])[]
}
export interface ArrangementPorts<Surface extends ArrangementSurface> {
  readonly rootStores: Readonly<Record<LayoutSurface, LayoutStore>>
  readonly nestedStores: NestedLayoutStores
  readonly regions: ArrangementRegions<Surface>
}
const ROOT_REGION = { main: 'main', left: 'left', dock: 'right', bottom: 'bottom' } satisfies Record<LayoutSurface, WorkbenchRegionId>

/** Capture closed roots from storage, then prefer live APIs over queued persistence writes. */
export const captureLayoutArrangement = <Surface extends ArrangementSurface>(
  ports: ArrangementPorts<Surface> & {
    readonly presentation: NonNullable<SavedLayout['presentation']>
  },
): SavedLayout => {
  const nested = ports.nestedStores.capture()
  for (const [region, api] of ports.regions.entries()) {
    if (region.startsWith('nested/')) {
      const path = nestedSurfacePathSchema.parse(region)
      nested[path] = api.toJSON()
    }
  }
  return {
    main: ports.regions.get('main')?.toJSON() ?? ports.rootStores.main.get(),
    left: ports.regions.get('left')?.toJSON() ?? ports.rootStores.left.get(),
    dock: ports.regions.get('right')?.toJSON() ?? ports.rootStores.dock.get(),
    bottom: ports.regions.get('bottom')?.toJSON() ?? ports.rootStores.bottom.get(),
    nested,
    presentation: ports.presentation,
  }
}

/**
 * Restore stores first so remounted descendants read the intended snapshot.
 * Never drive an API captured before its parent fromJSON destroyed its mount.
 */
export const restoreLayoutArrangement = <Surface extends ArrangementSurface>(
  layout: SavedLayout,
  ports: ArrangementPorts<Surface> & {
    readonly setBottomShown?: (shown: boolean) => void
    readonly setRightMode?: (mode: 'native' | 'dock') => void
  },
): void => {
  const live = ports.regions.entries()
  // Capture actual containment before any parent mutates. Origin paths remain
  // immutable after a move and therefore cannot by themselves determine depth.
  const parentOf = new Map<WorkbenchRegionId, WorkbenchRegionId>()
  for (const [region] of live) {
    if (!region.startsWith('nested/')) continue
    const panelId = nestedPanelId(nestedSurfacePathSchema.parse(region))
    const parent = live.find(([, api]) => api.getPanel(panelId) !== undefined)?.[0]
    if (parent !== undefined) parentOf.set(region, parent)
  }
  if (layout.nested !== undefined) ports.nestedStores.restore(layout.nested)
  for (const surface of LAYOUT_SURFACES) {
    const entry = layout[surface]
    if (entry === null) ports.rootStores[surface].remove()
    else if (entry !== undefined) ports.rootStores[surface].set(entry)
  }

  const restored = new Set<WorkbenchRegionId>()
  const restoreApi = (region: WorkbenchRegionId, api: Surface, entry: SerializedDockview | null): void => {
    if (ports.regions.get(region) !== api) return
    if (entry === null) api.clear()
    else api.fromJSON(entry)
    restored.add(region)
  }
  for (const surface of LAYOUT_SURFACES) {
    const region = ROOT_REGION[surface]
    const entry = layout[surface]
    const api = live.find(([id]) => id === region)?.[1]
    if (entry !== undefined && api !== undefined) restoreApi(region, api, entry)
  }
  const depthOf = (region: WorkbenchRegionId): number => {
    let cursor: WorkbenchRegionId | undefined = region
    const seen = new Set<WorkbenchRegionId>()
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = parentOf.get(cursor)
    }
    return seen.size
  }
  const parentRestored = (region: WorkbenchRegionId): boolean => {
    let cursor = parentOf.get(region)
    const seen = new Set<WorkbenchRegionId>()
    while (cursor !== undefined && !seen.has(cursor)) {
      if (restored.has(cursor)) return true
      seen.add(cursor)
      cursor = parentOf.get(cursor)
    }
    return false
  }
  const nested = live.filter(([region]) => region.startsWith('nested/')).sort(([a], [b]) => depthOf(a) - depthOf(b))
  for (const [region, api] of nested) {
    if (parentRestored(region)) continue
    const path = nestedSurfacePathSchema.parse(region)
    const entry = layout.nested?.[path]
    if (entry !== undefined) restoreApi(region, api, entry)
  }

  if (layout.presentation !== undefined) {
    ports.setBottomShown?.(layout.presentation.bottomShown)
    if (layout.presentation.rightMode !== undefined) ports.setRightMode?.(layout.presentation.rightMode)
  } else {
    // Legacy snapshots predate presentation flags and opened recorded regions.
    if (layout.bottom !== undefined) ports.setBottomShown?.(true)
    if (layout.dock !== undefined) ports.setRightMode?.('dock')
  }
}
