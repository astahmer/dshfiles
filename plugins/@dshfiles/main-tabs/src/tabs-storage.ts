import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import type { PersistedTabs } from './tabs-machine.js'

const idSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))
const targetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('panel'), panelId: idSchema, scope: Schema.optional(idSchema) }),
  Schema.Struct({ kind: Schema.Literal('thread'), sessionId: idSchema }),
])
const tabSchema = Schema.Struct({
  id: idSchema,
  target: targetSchema,
  pinned: Schema.Boolean,
  preview: Schema.Boolean,
  usedAt: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  title: Schema.optional(idSchema),
})
const tabSetSchema = Schema.Struct({ tabs: Schema.Array(tabSchema).check(Schema.isMaxLength(200)), activeTabId: Schema.NullOr(idSchema) })
const tabSets = Schema.Record(idSchema, tabSetSchema)
const atMostStoredSets = Schema.makeFilter<typeof tabSets.Type>(sets => (Object.keys(sets).length <= 500 ? true : 'At most 500 project tab sets are stored.'))

/** One document for every scope (global and each project) so switching the persistence setting loses nothing. */
export const storedTabs = createStoredValue({
  key: 'dshfiles.main-tabs.v1',
  schema: zodSchemaFromEffect(Schema.Struct({ lastProjectKey: Schema.NullOr(idSchema), sets: tabSets.check(atMostStoredSets) })),
  fallback: null,
})

export const saveTabs = (tabs: PersistedTabs): void => {
  storedTabs.set({
    lastProjectKey: tabs.lastProjectKey,
    sets: Object.fromEntries(Object.entries(tabs.sets).map(([key, set]) => [key, { tabs: [...set.tabs], activeTabId: set.activeTabId }])),
  })
}
