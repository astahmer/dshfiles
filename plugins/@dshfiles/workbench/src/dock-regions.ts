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
  // Each registration carries its own token: a surface that remounts with the
  // same Dockview instance (a settings flip re-renders it) registers again, and
  // the old disposer must not delete the newer registration.
  const slots = new Map<WorkbenchRegionId, { readonly api: DockviewApi; readonly token: object }>()
  return {
    set: (region, api) => {
      const token = {}
      slots.set(region, { api, token })
      return () => {
        if (slots.get(region)?.token === token) slots.delete(region)
      }
    },
    get: region => slots.get(region)?.api,
    entries: () =>
      REGION_ORDER.flatMap(region => {
        const slot = slots.get(region)
        return slot === undefined ? [] : [[region, slot.api] as const]
      }),
    holds: panelId => [...slots.values()].some(slot => slot.api.getPanel(panelId) !== undefined),
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
