import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Api, DshxPlugin, HostContext, HostEvents } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Clock, Effect, Layer, Option, Schema } from 'effect'
import { sessionActivity } from './adapters.js'
import { activityEventPayloadSchema, ingestOfPayload } from './activity-event-payload.js'
import { ActivityStore } from './activity-store.js'
import { ActivityTimeline } from './activity-timeline.js'
import { activityTimelineApi } from './api.js'
import { attentionApi } from './attention-api.js'
import { AttentionHost, attentionHandlers } from './attention-host.js'
import { AttentionInbox } from './attention-store.js'
import type { ActivityIngest } from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: unknown): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
    'dshfiles/activity/source-ready'(payload: { readonly source: 'project-checks-receipts'; readonly version: 1 }): void
  }
}

const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const projectChecksReadySchema = Schema.Struct({ source: Schema.Literal('project-checks-receipts'), version: Schema.Literal(1) })
const isProjectChecksReady = Schema.is(projectChecksReadySchema)
const decodePayload = Schema.decodeUnknownOption(activityEventPayloadSchema, { onExcessProperty: 'error' })

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 2000)

/** The Host edge: Cordis activity events become timeline ingests, and producers are asked to backfill once ready. */
const ActivityHostEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const timeline = yield* ActivityTimeline

    const record = (activity: Effect.Effect<ActivityIngest>) =>
      activity.pipe(
        Effect.flatMap(timeline.enqueue),
        Effect.asVoid,
        Effect.catch(error => Effect.sync(() => host.ctx.logger.warn('activity-timeline: ignored an invalid event: %s', error.message))),
      )
    const recordSession = (input: Omit<Parameters<typeof sessionActivity>[0], 'at'>) =>
      record(Effect.map(Clock.currentTimeMillis, at => sessionActivity({ ...input, at })))
    const requestBackfill = Effect.flatMap(Clock.currentTimeMillis, now =>
      Effect.sync(() => host.ctx.emit('dshfiles/activity/backfill', { since: now - BACKFILL_WINDOW_MS })),
    )

    yield* HostEvents.on('agent/created', ({ agent }) => recordSession({ kind: 'created', sessionId: agent.id }))
    yield* HostEvents.on('agent/disposed', ({ agent }) => recordSession({ kind: 'disposed', sessionId: agent.id }))
    yield* HostEvents.on('agent/status', ({ agent, status }) => recordSession({ kind: 'status', sessionId: agent.id, status }))
    yield* HostEvents.on('agent/error', ({ agent, error }) => recordSession({ kind: 'error', sessionId: agent.id, detail: describeError(error) }))
    yield* HostEvents.on('agent/inbox/inserted', ({ agent }) => recordSession({ kind: 'input', sessionId: agent.id }))
    yield* HostEvents.on('dshfiles/activity/source-ready', payload => (isProjectChecksReady(payload) ? requestBackfill : Effect.void))
    yield* HostEvents.on('dshfiles/activity/event', payload =>
      Option.match(decodePayload(payload), {
        onNone: () => Effect.void,
        onSome: decoded => record(Effect.sync(() => ingestOfPayload(decoded))),
      }),
    )
    yield* requestBackfill
  }),
)

const ActivityTimelineLive = Layer.mergeAll(ActivityHostEvents, AttentionHost.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(ActivityTimeline.layer, AttentionInbox.layer.pipe(Layer.provide(StorageDomain.layer)))),
  Layer.provide(ActivityStore.layer),
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)

export default DshxPlugin.make({
  name: 'activity-timeline',
  inject: ['agents', 'storageDomain'],
  layer: ActivityTimelineLive,
  apis: [
    Api.bind(attentionApi, attentionHandlers),
    Api.bind(activityTimelineApi, {
      page: input => ActivityTimeline.use(timeline => timeline.page(input)),
      attention: input => ActivityTimeline.use(timeline => timeline.attention(input.limit ?? 20)).pipe(Effect.map(events => ({ events: [...events] }))),
      stats: () => ActivityTimeline.use(timeline => timeline.stats),
      event: input => ActivityTimeline.use(timeline => timeline.event(input.eventId)),
      related: input =>
        ActivityTimeline.use(timeline => timeline.related(input.eventId, input.limit ?? 50)).pipe(Effect.map(events => ({ events: [...events] }))),
    }),
  ],
})
