import type { DockviewApi } from 'dockview-react'

/** The docking regions a panel can live in. */
export type WorkbenchRegionId = 'main' | 'right' | 'bottom'

export interface WorkbenchRegionRegistry {
  /** Register a live surface; the returned disposer removes it again. */
  readonly set: (region: WorkbenchRegionId, api: DockviewApi) => () => void
  readonly get: (region: WorkbenchRegionId) => DockviewApi | undefined
  /** Every live surface, in region order. */
  readonly entries: () => readonly (readonly [WorkbenchRegionId, DockviewApi])[]
  /** Whether any live surface already shows the panel. */
  readonly holds: (panelId: string) => boolean
}

const REGION_ORDER: readonly WorkbenchRegionId[] = ['main', 'right', 'bottom']

export const createWorkbenchRegionRegistry = (): WorkbenchRegionRegistry => {
  const apis = new Map<WorkbenchRegionId, DockviewApi>()
  return {
    set: (region, api) => {
      apis.set(region, api)
      return () => {
        if (apis.get(region) === api) apis.delete(region)
      }
    },
    get: region => apis.get(region),
    entries: () =>
      REGION_ORDER.flatMap(region => {
        const api = apis.get(region)
        return api === undefined ? [] : [[region, api] as const]
      }),
    holds: panelId => [...apis.values()].some(api => api.getPanel(panelId) !== undefined),
  }
}

declare global {
  /** One registry per page, shared by every bundle; the name carries the contract version. */
  var dshfilesWorkbenchRegionsV1: WorkbenchRegionRegistry | undefined
}

/**
 * The page-wide region registry. Each surface owns its Dockview instance and
 * registers it here, so the workbench can move a panel between regions: a panel
 * lives in exactly one region, and a drop in another takes it away.
 */
export const workbenchRegions = (): WorkbenchRegionRegistry => (globalThis.dshfilesWorkbenchRegionsV1 ??= createWorkbenchRegionRegistry())
