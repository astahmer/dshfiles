import type { Context, Effect } from '@deepseek-ai/cordis'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { communicationActivity, communicationMessage, integrationActivity, sessionActivity, verificationReceiptActivity, workspaceActivity } from './adapters.js'
import { activityTimelineApi } from './api.js'
import { verificationReceiptEventSchema } from './types.js'
import { createActivityTimelineService, type ActivityTimelineService } from './service.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: unknown): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
    'dshfiles/activity/source-ready'(payload: { readonly source: 'project-checks-receipts'; readonly version: 1 }): void
  }
}

let service: ActivityTimelineService | undefined

const requireService = (): ActivityTimelineService => {
  if (service === undefined) throw new Error('Activity timeline Host is not active.')
  return service
}

const api = activityTimelineApi.host({
  page: ({ input }) => requireService().page(input),
  attention: async ({ input }) => ({ events: [...(await requireService().attention(input.limit ?? 20))] }),
  stats: () => requireService().stats(),
  event: ({ input }) => requireService().event(input.eventId),
  related: async ({ input }) => ({ events: [...(await requireService().related(input.eventId, input.limit ?? 50))] }),
})

const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const activityEventPayloadSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['communication-activity', 'communication-message', 'integration', 'workspace']),
      value: z.unknown(),
    })
    .strict(),
  verificationReceiptEventSchema,
])

const projectChecksReadySchema = z
  .object({ source: z.literal('project-checks-receipts'), version: z.literal(1) })
  .strict()

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
  context.on('dshfiles/activity/source-ready', payload => {
    if (!projectChecksReadySchema.safeParse(payload).success) return undefined
    context.emit('dshfiles/activity/backfill', { since: Date.now() - BACKFILL_WINDOW_MS })
    return undefined
  })
  context.on('dshfiles/activity/event', payload => {
    const parsed = activityEventPayloadSchema.safeParse(payload)
    if (!parsed.success) return undefined
    if (parsed.data.kind === 'verification-receipt') {
      void active.ingest(verificationReceiptActivity(parsed.data.value)).catch(() => undefined)
      return undefined
    }
    if (parsed.data.kind === 'communication-activity')
      void active.ingest(communicationActivity(parsed.data.value as Parameters<typeof communicationActivity>[0])).catch(() => undefined)
    if (parsed.data.kind === 'communication-message') void active.ingest(communicationMessageSafe(parsed.data.value)).catch(() => undefined)
    if (parsed.data.kind === 'integration')
      void active.ingest(integrationActivity(parsed.data.value as Parameters<typeof integrationActivity>[0])).catch(() => undefined)
    if (parsed.data.kind === 'workspace')
      void active.ingest(workspaceActivity(parsed.data.value as Parameters<typeof workspaceActivity>[0])).catch(() => undefined)
    return undefined
  })
  return {
    async *[Symbol.asyncIterator]() {
      try {
        context.emit('dshfiles/activity/backfill', { since: Date.now() - BACKFILL_WINDOW_MS })
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
  setup: setupHost,
})

export default host
