import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { activityEventSchema, activityPageSchema, activitySourceSchema, activityLevelSchema } from './types.js'

const pageInputSchema = z
  .object({
    sources: z.array(activitySourceSchema).max(4).optional().describe('Only events from these sources.'),
    levels: z.array(activityLevelSchema).max(3).optional().describe('Only events at these levels.'),
    sessionId: z.string().min(1).max(256).optional().describe('Only events for one Session id.'),
    correlationId: z.string().min(1).max(128).optional().describe('Only events sharing one correlation id.'),
    search: z.string().trim().min(1).max(120).optional().describe('Case-insensitive literal search over event type, summary, and detail.'),
    detailed: z.boolean().optional().describe('Return every retained event without condensation.'),
    cursor: z.string().min(1).max(256).optional().describe('Opaque cursor from a previous page; omit for the newest page.'),
    limit: z.number().int().min(1).max(200).optional().describe('Maximum condensed items, 1 to 200; defaults to 60.'),
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

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const activityTimelineApi = defineApi({
  id: 'activity-timeline',
  version: 1,
  owner: '@dshfiles/activity-timeline',
  methods: {
    page: method({
      input: pageInputSchema,
      output: activityPageSchema,
      description:
        'Read one condensed page of the unified agent activity timeline (session, communication, and jj integration events), oldest-to-newest within the page. Read-only; it never activates or messages an Agent. Continue older pages with next_cursor.',
      tool: { name: 'activity_timeline_page', readOnly: true, render: compactJson },
    }),
    attention: method({
      input: z.object({ limit: z.number().int().min(1).max(100).optional().describe('Maximum events, 1 to 100; defaults to 20.') }).strict(),
      output: z.object({ events: z.array(activityEventSchema).max(100) }).strict(),
      description:
        'List retained events that need human attention (agent errors, blocked or failed integrations, missing workspaces, failed communication tool calls). Read-only.',
      tool: { name: 'activity_timeline_attention', readOnly: true, render: compactJson },
    }),
    stats: method({
      input: z.object({}).strict(),
      output: statsSchema,
      description: 'Report retained activity counts by source plus duplicate and attention counts. Read-only.',
      tool: { name: 'activity_timeline_stats', readOnly: true, render: compactJson },
    }),
    event: method({
      input: z.object({ eventId: z.string().min(1).max(256) }).strict(),
      output: activityEventSchema,
      description: 'Read one retained activity event by id.',
    }),
    related: method({
      input: z
        .object({
          eventId: z.string().min(1).max(256),
          limit: z.number().int().min(1).max(100).optional().describe('Maximum events, 1 to 100; defaults to 50.'),
        })
        .strict(),
      output: z.object({ events: z.array(activityEventSchema).max(100) }).strict(),
      description: 'List retained events correlated with one activity event id. Read-only.',
      tool: { name: 'activity_timeline_related', readOnly: true, render: compactJson },
    }),
  },
})
