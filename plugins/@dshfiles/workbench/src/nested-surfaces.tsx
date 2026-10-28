import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import type { ComponentType } from 'react'
import { z } from 'zod'
import { nestedLayoutStores, nestedSurfacePathSchema, type LayoutStore, type NestedLayouts } from './layout-store.js'
import { workbenchRegions, type NestedSurfacePath, type WorkbenchRegionId, type WorkbenchRegionRegistry, type WorkbenchRegionSurface } from './dock-regions.js'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from './registry.js'

export type { NestedSurfacePath } from './dock-regions.js'

const NESTED_PANEL_PREFIX = 'dshfiles-workbench.'
const pathTokenSchema = z.string().regex(/^[a-zA-Z0-9._-]+$/u)
const descriptorSchema = z.object({ path: nestedSurfacePathSchema, title: z.string().trim().min(1) })

/** Stable container identities, retained even when their containing surface is unmounted. */
export const nestedSurfaceDefinitions = createStoredValue({
  key: 'dshfiles.workbench.nested-surfaces.v1',
  schema: z.array(descriptorSchema),
  fallback: [],
})

/** Allocate once in an Add-container action, not during a component render. */
export const nestedSurfacePath = (parent: WorkbenchRegionId, token: string = crypto.randomUUID()): NestedSurfacePath => {
  pathTokenSchema.parse(token)
  const prefix = parent.startsWith('nested/') ? nestedSurfacePathSchema.parse(parent) : `nested/${parent}`
  return nestedSurfacePathSchema.parse(`${prefix}/${token}`)
}

/** Container panel identity and storage path stay stable when the container moves. */
export const nestedPanelId = (path: NestedSurfacePath): string => `${NESTED_PANEL_PREFIX}${nestedSurfacePathSchema.parse(path)}`

const pathOfPanel = (panelId: string): NestedSurfacePath | undefined => {
  if (!panelId.startsWith(NESTED_PANEL_PREFIX)) return undefined
  const result = nestedSurfacePathSchema.safeParse(panelId.slice(NESTED_PANEL_PREFIX.length))
  return result.success ? result.data : undefined
}

type RegionLookup = Pick<WorkbenchRegionRegistry<WorkbenchRegionSurface>, 'entries'>

/**
 * Apply to drag acceptance AND programmatic moves. Live containment wins over
 * an origin path (containers can move); an unmounted branch uses its persisted
 * hierarchical identity conservatively. Corrupt existing cycles reject moves.
 */
export const canMovePanelToRegion = (
  panelId: string,
  target: WorkbenchRegionId,
  regions: RegionLookup = workbenchRegions(),
  persisted?: Readonly<NestedLayouts>,
): boolean => {
  const moving = pathOfPanel(panelId)
  if (moving === undefined || !target.startsWith('nested/')) return true
  const snapshots = persisted ?? nestedLayoutStores.capture()
  const live = regions.entries()
  let current: WorkbenchRegionId = target
  const visited = new Set<WorkbenchRegionId>()
  while (current.startsWith('nested/')) {
    if (current === moving || visited.has(current)) return false
    visited.add(current)
    const currentPath = nestedSurfacePathSchema.parse(current)
    const containerId = nestedPanelId(currentPath)
    const parent = live.find(([, surface]) => surface.getPanel(containerId) !== undefined)?.[0]
    if (parent !== undefined) {
      current = parent
      continue
    }
    // Closed container branches still carry containment in saved layouts.
    // Ignore stale stored snapshots for any region whose live API is mounted.
    const savedParent = Object.entries(snapshots).find(
      ([path, layout]) => !live.some(([region]) => region === path) && layout?.panels[containerId] !== undefined,
    )?.[0]
    if (savedParent !== undefined) {
      current = nestedSurfacePathSchema.parse(savedParent)
      continue
    }
    // No mounted or persisted owner can prove this branch left its origin.
    return !currentPath.startsWith(`${moving}/`)
  }
  return true
}

/** The parent supplies a wrapper closing over registry, locale and move handlers. */
export interface NestedSurfaceProps {
  readonly store: LayoutStore
  readonly region: NestedSurfacePath
  readonly surface: NestedSurfacePath
}

/** Own every registration created during this plugin lifetime, including new Add actions. */
export const createNestedSurfaceRegistry = (registry: WorkbenchPanelRegistry, component: ComponentType<NestedSurfaceProps>) => {
  const owned = new Map<NestedSurfacePath, { definition: WorkbenchPanelDefinition; dispose: () => void }>()
  const register = (descriptor: z.infer<typeof descriptorSchema>): WorkbenchPanelDefinition => {
    const existing = owned.get(descriptor.path)
    if (existing?.definition.title === descriptor.title) return existing.definition
    const definition = createNestedSurface({ ...descriptor, component })
    const dispose = registry.register(definition)
    existing?.dispose()
    owned.set(descriptor.path, { definition, dispose })
    return definition
  }
  return {
    add: (parent: WorkbenchRegionId, title: string): WorkbenchPanelDefinition => register({ path: nestedSurfacePath(parent), title }),
    restore: (): void => {
      for (const descriptor of nestedSurfaceDefinitions.get()) register(descriptor)
    },
    dispose: (): void => {
      for (const entry of owned.values()) entry.dispose()
      owned.clear()
    },
  }
}

/**
 * Registry-definition factory, deliberately independent of WorkbenchView to
 * avoid a circular import. Rehydrate all nestedSurfaceDefinitions on startup
 * using the same supplied component; newly created paths persist immediately.
 */
export const createNestedSurface = (options: {
  readonly path: NestedSurfacePath
  readonly title: string
  readonly component: ComponentType<NestedSurfaceProps>
}): WorkbenchPanelDefinition => {
  const descriptor = descriptorSchema.parse(options)
  const definitions = nestedSurfaceDefinitions.get()
  const previous = definitions.find(entry => entry.path === descriptor.path)
  if (previous?.title !== descriptor.title) {
    nestedSurfaceDefinitions.set([...definitions.filter(entry => entry.path !== descriptor.path), descriptor])
  }
  const store = nestedLayoutStores.store(descriptor.path)
  const Surface = options.component
  const NestedSurface = (): JSX.Element => <Surface store={store} region={descriptor.path} surface={descriptor.path} />
  return {
    id: nestedPanelId(descriptor.path),
    title: descriptor.title,
    hiddenFromAdd: true,
    component: NestedSurface,
  }
}
