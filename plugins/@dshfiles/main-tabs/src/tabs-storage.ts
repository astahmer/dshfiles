import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import type { PersistedTabs } from './tabs-machine.js'

const idSchema = z.string().min(1).max(512)
const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('panel'), panelId: idSchema }),
  z.object({ kind: z.literal('thread'), sessionId: idSchema }),
])
const tabSchema = z.object({
  id: idSchema,
  target: targetSchema,
  pinned: z.boolean(),
  preview: z.boolean(),
  usedAt: z.number().int().nonnegative(),
})
const setSchema = z.object({ tabs: z.array(tabSchema).max(200), activeTabId: idSchema.nullable() })

/** One document for every scope (global and each project) so switching the persistence setting loses nothing. */
export const storedTabs = createStoredValue({
  key: 'dshfiles.main-tabs.v1',
  schema: z.object({
    lastProjectKey: idSchema.nullable(),
    sets: z.record(idSchema, setSchema).refine(sets => Object.keys(sets).length <= 500),
  }),
  fallback: null,
})

export const saveTabs = (tabs: PersistedTabs): void => {
  storedTabs.set({
    lastProjectKey: tabs.lastProjectKey,
    sets: Object.fromEntries(Object.entries(tabs.sets).map(([key, set]) => [key, { tabs: [...set.tabs], activeTabId: set.activeTabId }])),
  })
}
