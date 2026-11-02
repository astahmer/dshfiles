import { type Cause, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Queue, Schema, Stream } from 'effect'
import { ActivityStore, type ActivityStateWriteFailed, type ActivityStoreReadError, type IngestResult } from './activity-store.js'
import { ActivityTimelineCondensation } from './condensation.js'
import { activityIngestSchema, type ActivityEvent, type ActivityFilter, type ActivityIngest, type ActivityPage } from './types.js'

const DEFAULT_PAGE = 60
/** Buffered events flush within this delay, so an acknowledgement is delayed but never dropped. */
const INGEST_BATCH_DELAY = Duration.millis(25)
/** A burst this large flushes immediately instead of growing the buffer. */
const INGEST_BATCH_LIMIT = 200

export class ActivityEventNotFound extends Schema.TaggedError<ActivityEventNotFound>()(
  'ActivityEventNotFound',
  { eventId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'event-not-found' },
) {
  override get message(): string {
    return 'Activity event is no longer retained.'
  }
}

export class ActivityCursorInvalid extends Schema.TaggedError<ActivityCursorInvalid>()(
  'ActivityCursorInvalid',
  { cursor: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-cursor' },
) {
  override get message(): string {
    return 'Activity cursor is invalid.'
  }
}

/** An event a producer reported does not match the activity schema; it was not stored. */
export class ActivityIngestInvalid extends Schema.TaggedError<ActivityIngestInvalid>()('ActivityIngestInvalid', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'Activity event is malformed.'
  }
}

type IngestError = ActivityIngestInvalid | ActivityStoreReadError | ActivityStateWriteFailed

export interface ActivityStats {
  readonly retained: number
  readonly ingested: number
  readonly duplicates: number
  readonly attention: number
  readonly sources: Readonly<Record<string, number>>
}

interface PendingIngest {
  readonly event: ActivityEvent
  readonly settled: Deferred.Deferred<IngestResult, ActivityStoreReadError | ActivityStateWriteFailed>
}

const decodeIngest = Schema.decodeUnknownEffect(activityIngestSchema, { onExcessProperty: 'error' })

const normalize = Effect.fnUntraced(function* (input: ActivityIngest) {
  const parsed = yield* decodeIngest(input).pipe(Effect.mapError(cause => new ActivityIngestInvalid({ cause })))
  const event: ActivityEvent = {
    id: parsed.id,
    at: parsed.at,
    source: parsed.source,
    type: parsed.type,
    level: parsed.level ?? 'routine',
    sessionId: parsed.sessionId ?? null,
    workspaceId: parsed.workspaceId ?? null,
    taskId: parsed.taskId ?? null,
    correlationId: parsed.correlationId ?? null,
    causationId: parsed.causationId ?? null,
    summary: parsed.summary,
    detail: parsed.detail ?? null,
    metadata: parsed.metadata ?? {},
    references: parsed.references ?? [],
    provenance: parsed.provenance ?? 'reported',
  }
  return event
})

const cursorOf = (event: ActivityEvent): string => `${String(event.at)}:${event.id}`

const parseCursor = (cursor: string) => {
  const separator = cursor.indexOf(':')
  const at = Number(cursor.slice(0, separator))
  const id = cursor.slice(separator + 1)
  if (separator <= 0 || !Number.isSafeInteger(at) || at < 0 || id.length === 0) return Effect.fail(new ActivityCursorInvalid({ cursor }))
  return Effect.succeed({ at, id })
}

const make = Effect.gen(function* () {
  const store = yield* ActivityStore
  const queue = yield* Queue.unbounded<PendingIngest, Cause.Done>()

  const flush = (batch: ReadonlyArray<PendingIngest>) =>
    store.ingest(batch.map(item => item.event)).pipe(
      Effect.exit,
      Effect.flatMap(exit =>
        Effect.forEach(batch, (item, index) =>
          Deferred.done(
            item.settled,
            Exit.map(exit, results => results[index] ?? { event: item.event, duplicate: false }),
          ),
        ),
      ),
    )

  const consumer = yield* Stream.fromQueue(queue).pipe(
    Stream.groupedWithin(INGEST_BATCH_LIMIT, INGEST_BATCH_DELAY),
    Stream.runForEach(flush),
    Effect.forkScoped,
  )
  yield* Effect.addFinalizer(() => Queue.end(queue).pipe(Effect.andThen(Fiber.join(consumer))))

  const ingest = Effect.fn('activity timeline ingest')(function* (inputs: ReadonlyArray<ActivityIngest>) {
    const events = yield* Effect.forEach(inputs, normalize)
    return yield* store.ingest(events)
  })

  /**
   * Buffer one event into the next batch. It completes when that batch is durably written, so callers keep
   * acknowledgement semantics while a burst of events costs one read/write cycle instead of one each.
   */
  const enqueue = Effect.fn('activity timeline enqueue')(function* (input: ActivityIngest) {
    const event = yield* normalize(input)
    const settled = yield* Deferred.make<IngestResult, ActivityStoreReadError | ActivityStateWriteFailed>()
    yield* Queue.offer(queue, { event, settled })
    return yield* Deferred.await(settled)
  })

  const page = Effect.fn('activity timeline page')(function* (filter: ActivityFilter) {
    const state = yield* store.read
    const limit = Math.max(1, Math.min(200, filter.limit ?? DEFAULT_PAGE))
    const cursor = filter.cursor === undefined ? undefined : yield* parseCursor(filter.cursor)
    const search = filter.search?.toLocaleLowerCase()
    const sources = filter.sources === undefined ? undefined : new Set(filter.sources)
    const levels = filter.levels === undefined ? undefined : new Set(filter.levels)
    const matching = state.events.filter(event => {
      if (cursor !== undefined && (event.at > cursor.at || (event.at === cursor.at && event.id >= cursor.id))) return false
      if (filter.before !== undefined && event.at >= filter.before) return false
      if (sources !== undefined && !sources.has(event.source)) return false
      if (levels !== undefined && !levels.has(event.level)) return false
      if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false
      if (filter.correlationId !== undefined && event.correlationId !== filter.correlationId) return false
      if (search !== undefined && !`${event.type} ${event.summary} ${event.detail ?? ''}`.toLocaleLowerCase().includes(search)) return false
      return true
    })
    const slice = matching.slice(-limit)
    const oldest = slice[0]
    const result: ActivityPage = {
      items: ActivityTimelineCondensation.condenseEvents(slice, { detailed: filter.detailed === true }),
      nextCursor: matching.length > slice.length && oldest !== undefined ? cursorOf(oldest) : null,
      hasMore: matching.length > slice.length,
      newestAt: state.events.at(-1)?.at ?? null,
      attentionCount: state.events.filter(event => event.level === 'attention').length,
      totalRetained: state.events.length,
    }
    return result
  })

  const attention = Effect.fn('activity timeline attention')(function* (limit: number) {
    const state = yield* store.read
    return state.events
      .filter(event => event.level === 'attention')
      .slice(-Math.max(1, Math.min(100, limit)))
      .reverse()
  })

  const retainedEvent = Effect.fn('activity timeline event')(function* (eventId: string) {
    const state = yield* store.read
    const event = state.events.find(candidate => candidate.id === eventId)
    if (event === undefined) return yield* new ActivityEventNotFound({ eventId })
    return event
  })

  const related = Effect.fn('activity timeline related')(function* (eventId: string, limit: number) {
    const state = yield* store.read
    const event = state.events.find(candidate => candidate.id === eventId)
    if (event === undefined) return yield* new ActivityEventNotFound({ eventId })
    if (event.correlationId === null) return [event]
    return state.events.filter(candidate => candidate.correlationId === event.correlationId).slice(-Math.max(1, Math.min(100, limit)))
  })

  const stats = Effect.fn('activity timeline stats')(function* () {
    const state = yield* store.read
    const sources: Record<string, number> = {}
    for (const event of state.events) sources[event.source] = (sources[event.source] ?? 0) + 1
    const result: ActivityStats = {
      retained: state.events.length,
      ingested: state.ingestCount,
      duplicates: state.duplicateCount,
      attention: state.events.filter(event => event.level === 'attention').length,
      sources,
    }
    return result
  })

  return ActivityTimeline.of({ ingest, enqueue, page, attention, event: retainedEvent, related, stats: stats() })
})

/** The activity feed: batched durable ingest and the condensed, filtered reads over the retained window. */
export class ActivityTimeline extends Context.Service<
  ActivityTimeline,
  {
    readonly ingest: (inputs: ReadonlyArray<ActivityIngest>) => Effect.Effect<ReadonlyArray<IngestResult>, IngestError>
    readonly enqueue: (input: ActivityIngest) => Effect.Effect<IngestResult, IngestError>
    readonly page: (filter: ActivityFilter) => Effect.Effect<ActivityPage, ActivityStoreReadError | ActivityCursorInvalid>
    readonly attention: (limit: number) => Effect.Effect<ReadonlyArray<ActivityEvent>, ActivityStoreReadError>
    readonly event: (eventId: string) => Effect.Effect<ActivityEvent, ActivityStoreReadError | ActivityEventNotFound>
    readonly related: (eventId: string, limit: number) => Effect.Effect<ReadonlyArray<ActivityEvent>, ActivityStoreReadError | ActivityEventNotFound>
    readonly stats: Effect.Effect<ActivityStats, ActivityStoreReadError>
  }
>()('@dshfiles/activity-timeline/ActivityTimeline') {
  static readonly layer = Layer.effect(ActivityTimeline, make)
}
