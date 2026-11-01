import * as Schema from 'effect/Schema'
import { createEffectStoredValue } from './effect-stored-value.js'
import { savedLayoutSchema, type SavedLayout } from './saved-layouts.js'

const semanticLayoutsSchema = Schema.Record(Schema.String.check(Schema.isMinLength(1)), savedLayoutSchema)
const EMPTY_LAYOUTS: Record<string, SavedLayout> = {}

/** Project/global actor sets keep their complete region arrangement independently. */
export const semanticLayouts = createEffectStoredValue({
  key: 'dshfiles.workbench.semantic-layouts.v1',
  schema: semanticLayoutsSchema,
  fallback: EMPTY_LAYOUTS,
})

export interface SemanticScopeLayouts {
  readonly capture: () => SavedLayout
  readonly restore: (layout: SavedLayout) => void
  readonly store?: Pick<typeof semanticLayouts, 'get' | 'set'>
}
