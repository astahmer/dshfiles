import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import type { SerializedDockview } from 'dockview-react'
import { z } from 'zod'
import { layoutSchema, nestedLayoutStores, nestedSurfacePathSchema, type LayoutSurface, type NestedLayouts, type NestedLayoutStores } from './layout-store.js'

/** One named arrangement: whatever each region held when it was saved. A region it did not record stays as it is. */
export interface SavedLayout {
  readonly main?: SerializedDockview | null | undefined
  readonly left?: SerializedDockview | null | undefined
  readonly dock?: SerializedDockview | null | undefined
  readonly bottom?: SerializedDockview | null | undefined
  readonly presentation?:
    | {
        readonly bottomShown: boolean
        readonly rightMode?: 'native' | 'dock' | undefined
      }
    | undefined
  /** Includes unmounted containers; null explicitly restores an empty/default surface. */
  readonly nested?: NestedLayouts | undefined
}

export const savedLayoutSchema = z.object({
  main: layoutSchema.nullable().optional(),
  left: layoutSchema.nullable().optional(),
  dock: layoutSchema.nullable().optional(),
  bottom: layoutSchema.nullable().optional(),
  presentation: z.object({ bottomShown: z.boolean(), rightMode: z.enum(['native', 'dock']).optional() }).optional(),
  nested: z.record(nestedSurfacePathSchema, layoutSchema.nullable()).optional(),
})
const layoutsSchema = z.record(z.string().min(1).max(64), savedLayoutSchema)

/** Nothing saved yet; one shared empty map keeps the fallback reference stable. */
const NO_SAVED_LAYOUTS: SavedLayoutMap = {}

/** Named layouts live beside the live ones in this browser: presentation state, not Host state. */
export const savedLayouts = createStoredValue({
  key: 'dshfiles.workbench.saved-layouts.v1',
  schema: layoutsSchema,
  fallback: NO_SAVED_LAYOUTS,
})

/** Every named layout this browser holds, keyed by name. */
export type SavedLayoutMap = Record<string, SavedLayout>

export type SavedLayoutStore = typeof savedLayouts

/**
 * Pure operations over the saved-layout record. Grouped because they are one
 * domain: what a name holds, and what a change to one name leaves behind.
 */
export class SavedLayouts {
  /** The stored names, alphabetically, so a menu does not reshuffle with insertion order. */
  static names(layouts: Readonly<SavedLayoutMap>): readonly string[] {
    return Object.keys(layouts).sort((left, right) => left.localeCompare(right))
  }

  /** Store one arrangement under `name`, replacing a name it already holds. */
  static with(layouts: Readonly<SavedLayoutMap>, name: string, layout: SavedLayout) {
    return { ...layouts, [name]: layout }
  }

  static without(layouts: Readonly<SavedLayoutMap>, name: string) {
    const { [name]: _removed, ...rest } = layouts
    return rest
  }

  /** Rename in place, keeping the arrangement; a name already taken is replaced, and an absent source changes nothing. */
  static renamed(layouts: Readonly<SavedLayoutMap>, from: string, to: string) {
    const layout = layouts[from]
    if (layout === undefined || from === to) return { ...layouts }
    return SavedLayouts.with(SavedLayouts.without(layouts, from), to, layout)
  }

  /** Add all known nested paths, including containers with no mounted Dockview. */
  static captureNested(layout: SavedLayout, stores: NestedLayoutStores = nestedLayoutStores): SavedLayout {
    return { ...layout, nested: stores.capture() }
  }

  /** Restore nested storage before mounting parent layouts; legacy snapshots leave it untouched. */
  static restoreNested(layout: SavedLayout, stores: NestedLayoutStores = nestedLayoutStores): void {
    if (layout.nested !== undefined) stores.restore(layout.nested)
  }

  /** One region's entry from a saved layout, or undefined when the layout did not record that region. */
  static surface(layout: SavedLayout, surface: LayoutSurface): SerializedDockview | null | undefined {
    return layout[surface]
  }
}
