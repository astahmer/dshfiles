import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { activityEventSchema, activityPageSchema, activitySourceSchema, activityLevelSchema } from './types.js'

const pageInputSchema = z
  .object({
    sources: z.array(activitySourceSchema).max(4).optional(),
    levels: z.array(activityLevelSchema).max(3).optional(),
    sessionId: z.string().min(1).max(256).optional(),
    correlationId: z.string().min(1).max(128).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    detailed: z.boolean().optional(),
    cursor: z.string().min(1).max(256).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict()

const statsSchema = z
  .object({
    retained: z.number().int().nonnegative(),
    ingested: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    attention: z.number().int().nonnegative(),
    sources: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict()

export const activityTimelineApi = defineApi({
  id: 'activity-timeline',
  version: 1,
  methods: {
    page: method({ input: pageInputSchema, output: activityPageSchema }),
    attention: method({ input: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(), output: z.object({ events: z.array(activityEventSchema).max(100) }).strict() }),
    stats: method({ input: z.object({}).strict(), output: statsSchema }),
    event: method({ input: z.object({ eventId: z.string().min(1).max(256) }).strict(), output: activityEventSchema }),
    related: method({
      input: z.object({ eventId: z.string().min(1).max(256), limit: z.number().int().min(1).max(100).optional() }).strict(),
      output: z.object({ events: z.array(activityEventSchema).max(100) }).strict(),
    }),
  },
})
