import type { Context, Effect } from '@deepseek-ai/cordis'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { communicationActivity, communicationMessage, integrationActivity, sessionActivity } from './adapters.js'
import { activityTimelineApi } from './api.js'
import { createActivityTimelineService, type ActivityTimelineService } from './service.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: unknown): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
  }
}

const summaryOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { summary: { type: 'string', required: true } },
} satisfies ValueSchemaSpec

const summaryOutput = {
  schema: summaryOutputSchema,
  render(_args: {}, value: InferValue<typeof summaryOutputSchema>) {
    return [{ type: 'text' as const, text: value.summary }]
  },
}

let service: ActivityTimelineService | undefined

const requireService = (): ActivityTimelineService => {
  if (service === undefined) throw new Error('Activity timeline Host is not active.')
  return service
}

const pageTool = defineTool({
  name: 'activity_timeline_page',
  description:
    'Read one condensed page of the unified agent activity timeline (session, communication, and jj integration events), oldest-to-newest within the page. Read-only; it never activates or messages an Agent. Continue older pages with next_cursor.',
  parameters: {
    cursor: { type: 'string', description: 'Opaque cursor from a previous page; omit for the newest page.' },
    limit: { type: 'integer', description: 'Maximum condensed items, 1 to 200; defaults to 60.' },
    search: { type: 'string', description: 'Case-insensitive literal search over event type, summary, and detail.' },
    sessionId: { type: 'string', description: 'Only events for one Session id.' },
    correlationId: { type: 'string', description: 'Only events sharing one correlation id.' },
    detailed: { type: 'string', enum: ['true', 'false'], description: 'When true, return every retained event without condensation.' },
  },
  output: summaryOutput,
  execute: async args => ({
    summary: JSON.stringify(
      await requireService().page({
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.search === undefined ? {} : { search: args.search }),
        ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
        ...(args.correlationId === undefined ? {} : { correlationId: args.correlationId }),
        ...(args.detailed === undefined ? {} : { detailed: args.detailed === 'true' }),
      }),
    ),
  }),
})

const attentionTool = defineTool({
  name: 'activity_timeline_attention',
  description: 'List retained events that need human attention (agent errors, blocked or failed integrations, missing workspaces, failed communication tool calls). Read-only.',
  parameters: { limit: { type: 'integer', description: 'Maximum events, 1 to 100; defaults to 20.' } },
  output: summaryOutput,
  execute: async args => ({ summary: JSON.stringify({ events: await requireService().attention(args.limit ?? 20) }) }),
})

const statsTool = defineTool({
  name: 'activity_timeline_stats',
  description: 'Report retained activity counts by source plus duplicate and attention counts. Read-only.',
  parameters: {},
  output: summaryOutput,
  execute: async () => ({ summary: JSON.stringify(await requireService().stats()) }),
})

const relatedTool = defineTool({
  name: 'activity_timeline_related',
  description: 'List retained events correlated with one activity event id. Read-only.',
  parameters: {
    eventId: { type: 'string', required: true },
    limit: { type: 'integer', description: 'Maximum events, 1 to 100; defaults to 50.' },
  },
  output: summaryOutput,
  execute: async args => ({ summary: JSON.stringify({ events: await requireService().related(args.eventId, args.limit ?? 50) }) }),
})

const api = activityTimelineApi.host({
  page: ({ input }) => requireService().page(input),
  attention: async ({ input }) => ({ events: [...(await requireService().attention(input.limit ?? 20))] }),
  stats: () => requireService().stats(),
  event: ({ input }) => requireService().event(input.eventId),
  related: async ({ input }) => ({ events: [...(await requireService().related(input.eventId, input.limit ?? 50))] }),
})

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 2000)

const setupHost = (context: Context): Effect<void> => {
  const active = createActivityTimelineService()
  service = active
  context.on('agent/created', ({ agent }) => {
    void active.ingest(sessionActivity({ kind: 'created', at: Date.now(), sessionId: agent.id }))
    return undefined
  })
  context.on('agent/disposed', ({ agent }) => {
    void active.ingest(sessionActivity({ kind: 'disposed', at: Date.now(), sessionId: agent.id }))
    return undefined
  })
  context.on('agent/status', ({ agent, status }) => {
    void active.ingest(sessionActivity({ kind: 'status', at: Date.now(), sessionId: agent.id, status }))
    return undefined
  })
  context.on('agent/error', ({ agent, error }) => {
    void active.ingest(sessionActivity({ kind: 'error', at: Date.now(), sessionId: agent.id, detail: describeError(error) }))
    return undefined
  })
  context.on('agent/inbox/inserted', ({ agent }) => {
    void active.ingest(sessionActivity({ kind: 'input', at: Date.now(), sessionId: agent.id }))
    return undefined
  })
  context.on('dshfiles/activity/event', payload => {
    const parsed = z
      .object({
        kind: z.enum(['communication-activity', 'communication-message', 'integration']),
        value: z.unknown(),
      })
      .strict()
      .safeParse(payload)
    if (!parsed.success) return undefined
    if (parsed.data.kind === 'communication-activity') void active.ingest(communicationActivity(parsed.data.value as Parameters<typeof communicationActivity>[0]))
    if (parsed.data.kind === 'communication-message') void active.ingest(communicationMessageSafe(parsed.data.value))
    if (parsed.data.kind === 'integration') void active.ingest(integrationActivity(parsed.data.value as Parameters<typeof integrationActivity>[0]))
    return undefined
  })
  return {
    async *[Symbol.asyncIterator]() {
      try {
        context.emit('dshfiles/activity/backfill', { since: Date.now() - 7 * 24 * 60 * 60 * 1000 })
        yield async () => {
          if (service === active) service = undefined
        }
      } catch (error) {
        if (service === active) service = undefined
        throw error
      }
    },
  }
}

const communicationMessageSafe = (value: unknown): Parameters<ActivityTimelineService['ingest']>[0] => {
  const parsed = z
    .object({
      at: z.number().int().nonnegative(),
      messageId: z.string().min(1).max(256),
      senderId: z.string().min(1).max(256),
      recipientCount: z.number().int().nonnegative(),
      intent: z.enum(['notice', 'request']),
      topic: z.string().max(128).nullable(),
      correlationId: z.string().max(128).optional(),
      sessionId: z.string().max(256).nullable().optional(),
    })
    .strict()
    .parse(value)
  return communicationMessage(parsed)
}

const host = defineHost({
  name: 'activity-timeline',
  inject: ['agents'],
  apis: [api],
  tools: [pageTool, attentionTool, statsTool, relatedTool],
  setup: setupHost,
})

export default host
