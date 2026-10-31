import { Context, Effect, Layer, Schema } from 'effect'
import { createActivityTimelineService, type ActivityTimelineService, type ActivityTimelineServiceOptions } from './service.js'
import type { ActivityFilter, ActivityIngest } from './types.js'

export class ActivityTimelineFailure extends Schema.TaggedError<ActivityTimelineFailure>()('ActivityTimelineFailure', {
  message: Schema.String,
  code: Schema.String,
}) {}

const failure = (error: unknown): ActivityTimelineFailure => {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return new ActivityTimelineFailure({ code: error.code, message: error.message })
  }
  return new ActivityTimelineFailure({ code: 'activity-failed', message: 'Activity timeline operation failed.' })
}

export class ActivityTimeline extends Context.Service<ActivityTimeline, ActivityTimelineService>()('activity-timeline/Service') {
  static layer(options: ActivityTimelineServiceOptions = {}) {
    return Layer.effect(
      ActivityTimeline,
      Effect.acquireRelease(
        Effect.sync(() => createActivityTimelineService(options)),
        service => Effect.promise(() => service.drain()),
      ),
    )
  }
}

export const activityTimelinePage = Effect.fn('activity timeline page')(function* (filter: ActivityFilter) {
  const service = yield* ActivityTimeline
  return yield* Effect.tryPromise({ try: () => service.page(filter), catch: failure })
})

export const activityTimelineAttention = Effect.fn('activity timeline attention')(function* (limit: number) {
  const service = yield* ActivityTimeline
  return yield* Effect.tryPromise({ try: () => service.attention(limit), catch: failure })
})

export const activityTimelineStats = Effect.fn('activity timeline stats')(function* () {
  const service = yield* ActivityTimeline
  return yield* Effect.tryPromise({ try: () => service.stats(), catch: failure })
})

export const activityTimelineEvent = Effect.fn('activity timeline event')(function* (eventId: string) {
  const service = yield* ActivityTimeline
  return yield* Effect.tryPromise({ try: () => service.event(eventId), catch: failure })
})

export const activityTimelineRelated = Effect.fn('activity timeline related')(function* (eventId: string, limit: number) {
  const service = yield* ActivityTimeline
  return yield* Effect.tryPromise({ try: () => service.related(eventId, limit), catch: failure })
})

export const activityTimelineEnqueue = Effect.fn('activity timeline enqueue')(function* (input: ActivityIngest) {
  const service = yield* ActivityTimeline
  return yield* Effect.tryPromise({ try: () => service.enqueue(input), catch: failure })
})
