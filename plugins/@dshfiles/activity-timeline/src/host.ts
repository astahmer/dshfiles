import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Effect, Option, Schema } from 'effect'
import {
  backlogActivity,
  communicationActivity,
  communicationMessage,
  integrationActivity,
  sessionActivity,
  verificationReceiptActivity,
  workspaceActivity,
} from './adapters.js'
import { activityTimelineApi } from './api.js'
import { backlogActivitySchema, activityLevelSchema, verificationReceiptEventSchema, type ActivityIngest } from './types.js'
import {
  ActivityTimeline,
  activityTimelineAttention,
  activityTimelineEvent,
  activityTimelinePage,
  activityTimelineRelated,
  activityTimelineStats,
} from './activity-timeline-effect.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: unknown): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
    'dshfiles/activity/source-ready'(payload: { readonly source: 'project-checks-receipts'; readonly version: 1 }): void
  }
}

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: ActivityTimeline.layer(),
  setup: (context: CordisContext) =>
    Effect.gen(function* () {
      const active = yield* ActivityTimeline
      const recordActivity = (produce: () => ActivityIngest): void => {
        try {
          void active.enqueue(produce()).catch(error => {
            context.logger.warn('activity-timeline: ignored an invalid event: %s', describeError(error))
          })
        } catch (error) {
          context.logger.warn('activity-timeline: ignored an invalid event: %s', describeError(error))
        }
      }
      context.on('agent/created', ({ agent }) => {
        recordActivity(() => sessionActivity({ kind: 'created', at: Date.now(), sessionId: agent.id }))
        return undefined
      })
      context.on('agent/disposed', ({ agent }) => {
        recordActivity(() => sessionActivity({ kind: 'disposed', at: Date.now(), sessionId: agent.id }))
        return undefined
      })
      context.on('agent/status', ({ agent, status }) => {
        recordActivity(() => sessionActivity({ kind: 'status', at: Date.now(), sessionId: agent.id, status }))
        return undefined
      })
      context.on('agent/error', ({ agent, error }) => {
        recordActivity(() => sessionActivity({ kind: 'error', at: Date.now(), sessionId: agent.id, detail: describeError(error) }))
        return undefined
      })
      context.on('agent/inbox/inserted', ({ agent }) => {
        recordActivity(() => sessionActivity({ kind: 'input', at: Date.now(), sessionId: agent.id }))
        return undefined
      })
      context.on('dshfiles/activity/source-ready', payload => {
        if (Option.isNone(Schema.decodeUnknownOption(projectChecksReadySchema, { onExcessProperty: 'error' })(payload))) return undefined
        context.emit('dshfiles/activity/backfill', { since: Date.now() - BACKFILL_WINDOW_MS })
        return undefined
      })
      context.on('dshfiles/activity/event', payload => {
        const parsed = Schema.decodeUnknownOption(activityEventPayloadSchema, { onExcessProperty: 'error' })(payload)
        if (Option.isNone(parsed)) return undefined
        const event = parsed.value
        if (event.kind === 'verification-receipt') {
          const receipt = event.value
          recordActivity(() => verificationReceiptActivity(receipt))
          return undefined
        }
        if (event.kind === 'communication-activity') recordActivity(() => communicationActivity(event.value as Parameters<typeof communicationActivity>[0]))
        if (event.kind === 'communication-message') recordActivity(() => communicationMessageSafe(event.value))
        if (event.kind === 'integration') recordActivity(() => integrationActivity(event.value as Parameters<typeof integrationActivity>[0]))
        if (event.kind === 'backlog') {
          const backlogEntry = event.value
          recordActivity(() => backlogActivity(backlogEntry))
          return undefined
        }
        if (event.kind === 'workspace') {
          const workspaceEntry = event.value
          recordActivity(() => workspaceActivity(workspaceEntry))
        }
        return undefined
      })
      context.emit('dshfiles/activity/backfill', { since: Date.now() - BACKFILL_WINDOW_MS })
    }),
})

const api = hostApi(activityTimelineApi, {
  page: ({ input }) => activityTimelinePage(input),
  attention: ({ input }) => Effect.map(activityTimelineAttention(input.limit ?? 20), events => ({ events: [...events] })),
  stats: () => activityTimelineStats(),
  event: ({ input }) => activityTimelineEvent(input.eventId),
  related: ({ input }) => Effect.map(activityTimelineRelated(input.eventId, input.limit ?? 50), events => ({ events: [...events] })),
})

const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const workspaceActivityValueSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  at: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  level: activityLevelSchema,
  summary: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000))),
  sessionId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  correlationId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  workspaceId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  workspaceName: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
})

const activityEventPayloadSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(['communication-activity', 'communication-message', 'integration']),
    value: Schema.Unknown,
  }),
  Schema.Struct({ kind: Schema.Literal('workspace'), value: workspaceActivityValueSchema }),
  Schema.Struct({ kind: Schema.Literal('backlog'), value: backlogActivitySchema }),
  verificationReceiptEventSchema,
])

const projectChecksReadySchema = Schema.Struct({ source: Schema.Literal('project-checks-receipts'), version: Schema.Literal(1) })

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 2000)

const communicationMessageSafe = (value: unknown): ActivityIngest => {
  const parsed = Schema.decodeUnknownSync(
    Schema.Struct({
      at: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      messageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
      senderId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
      recipientCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      intent: Schema.Literals(['notice', 'request']),
      topic: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
      correlationId: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
      sessionId: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(256)))),
    }),
  )(value)
  return communicationMessage(parsed)
}

const host = defineHost({
  ...effectPlugin,
  name: 'activity-timeline',
  inject: ['agents'],
  apis: [api],
})

export default host
