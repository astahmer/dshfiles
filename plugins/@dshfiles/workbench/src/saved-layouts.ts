import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import type { SerializedDockview } from 'dockview-react'
import { z } from 'zod'
import { layoutSchema, type LayoutSurface } from './layout-store.js'

/** One named arrangement: whatever each region held when it was saved. A region it did not record stays as it is. */
export interface SavedLayout {
  readonly main?: SerializedDockview | undefined
  readonly dock?: SerializedDockview | undefined
  readonly bottom?: SerializedDockview | undefined
}

const layoutsSchema = z.record(
  z.string().min(1).max(64),
  z.object({
    main: layoutSchema.optional(),
    dock: layoutSchema.optional(),
    bottom: layoutSchema.optional(),
  }),
)

/** Named layouts live beside the live ones in this browser: presentation state, not Host state. */
export const savedLayouts = createStoredValue({
  key: 'dshfiles.workbench.saved-layouts.v1',
  schema: layoutsSchema,
  fallback: {} as Record<string, SavedLayout>,
})

export type SavedLayoutStore = typeof savedLayouts

/** The stored names, alphabetically, so a menu does not reshuffle with insertion order. */
export const layoutNames = (layouts: Readonly<Record<string, SavedLayout>>): readonly string[] => Object.keys(layouts).sort((left, right) => left.localeCompare(right))

/** Store one arrangement under `name`, replacing a name it already holds. */
export const withSavedLayout = (
  layouts: Readonly<Record<string, SavedLayout>>,
  name: string,
  layout: SavedLayout,
): Record<string, SavedLayout> => ({ ...layouts, [name]: layout })

export const withoutSavedLayout = (layouts: Readonly<Record<string, SavedLayout>>, name: string): Record<string, SavedLayout> => {
  const { [name]: _removed, ...rest } = layouts
  return rest
}

/** Rename in place, keeping the arrangement; a name already taken is replaced, and an absent source changes nothing. */
export const renamedSavedLayout = (
  layouts: Readonly<Record<string, SavedLayout>>,
  from: string,
  to: string,
): Record<string, SavedLayout> => {
  const layout = layouts[from]
  if (layout === undefined || from === to) return { ...layouts }
  return withSavedLayout(withoutSavedLayout(layouts, from), to, layout)
}

/** One region's entry from a saved layout, or undefined when the layout did not record that region. */
export const savedSurface = (layout: SavedLayout, surface: LayoutSurface): SerializedDockview | undefined => layout[surface]
