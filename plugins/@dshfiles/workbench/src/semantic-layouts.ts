import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { savedLayoutSchema, type SavedLayout } from './saved-layouts.js'

const semanticLayoutsSchema = z.record(z.string().min(1), savedLayoutSchema)
const EMPTY_LAYOUTS: Record<string, SavedLayout> = {}

/** Project/global actor sets keep their complete region arrangement independently. */
export const semanticLayouts = createStoredValue({
  key: 'dshfiles.workbench.semantic-layouts.v1',
  schema: semanticLayoutsSchema,
  fallback: EMPTY_LAYOUTS,
})

export interface SemanticScopeLayouts {
  readonly capture: () => SavedLayout
  readonly restore: (layout: SavedLayout) => void
  readonly store?: Pick<typeof semanticLayouts, 'get' | 'set'>
}
