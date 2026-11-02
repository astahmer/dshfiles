import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { activityEventSchema, activityPageSchema, activitySourceSchema, activityLevelSchema } from './types.js'

const pageInputSchema = Schema.Struct({
  sources: Schema.optional(Schema.Array(activitySourceSchema).check(Schema.isMaxLength(4)).annotate({ description: 'Only events from these sources.' })),
  levels: Schema.optional(Schema.Array(activityLevelSchema).check(Schema.isMaxLength(3)).annotate({ description: 'Only events at these levels.' })),
  sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({ description: 'Only events for one Session id.' })),
  correlationId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({ description: 'Only events sharing one correlation id.' })),
  search: Schema.optional(
    Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)).annotate({ description: 'Case-insensitive literal search over event type, summary, and detail.' }),
  ),
  detailed: Schema.optional(Schema.Boolean.annotate({ description: 'Return every retained event without condensation.' })),
  cursor: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({ description: 'Opaque cursor from a previous page; omit for the newest page.' }),
  ),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)).annotate({
      description: 'Maximum condensed items, 1 to 200; defaults to 60.',
    }),
  ),
})

const statsSchema = Schema.Struct({
  retained: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ingested: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  duplicates: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  attention: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  sources: Schema.Record(Schema.String, Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})

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
      input: Schema.Struct({ limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)).annotate({ description: 'Maximum events, 1 to 100; defaults to 20.' })) }),
      output: Schema.Struct({ events: Schema.Array(activityEventSchema).check(Schema.isMaxLength(100)) }),
      description:
        'List retained events that need human attention (agent errors, blocked or failed integrations, missing workspaces, failed communication tool calls). Read-only.',
      tool: { name: 'activity_timeline_attention', readOnly: true, render: compactJson },
    }),
    stats: method({
      input: Schema.Struct({}),
      output: statsSchema,
      description: 'Report retained activity counts by source plus duplicate and attention counts. Read-only.',
      tool: { name: 'activity_timeline_stats', readOnly: true, render: compactJson },
    }),
    event: method({
      input: Schema.Struct({ eventId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)) }),
      output: activityEventSchema,
      description: 'Read one retained activity event by id: its source, level, summary, bounded detail and references. Read-only.',
      tool: { name: 'activity_timeline_event', readOnly: true, render: compactJson },
    }),
    related: method({
      input: Schema.Struct({
        eventId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
        limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)).annotate({ description: 'Maximum events, 1 to 100; defaults to 50.' })),
      }),
      output: Schema.Struct({ events: Schema.Array(activityEventSchema).check(Schema.isMaxLength(100)) }),
      description: 'List retained events correlated with one activity event id. Read-only.',
      tool: { name: 'activity_timeline_related', readOnly: true, render: compactJson },
    }),
  },
})
