import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { Clock, Config, Context, Effect, FileSystem, Layer, Option, Path, type PlatformError, Ref, Schema, Semaphore } from 'effect'
import { activityStateSchema, type ActivityEvent, type ActivityState } from './types.js'

const MAX_EVENTS = 5000
/** A cached snapshot older than this is re-read even when the file's metadata looks unchanged. */
const STATE_FRESHNESS_MS = 30_000

export class ActivityStateUnreadable extends Schema.TaggedError<ActivityStateUnreadable>()(
  'ActivityStateUnreadable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'state-unreadable' },
) {
  override get message(): string {
    return 'Activity state is unreadable.'
  }
}

export class ActivityStateInvalid extends Schema.TaggedError<ActivityStateInvalid>()(
  'ActivityStateInvalid',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'state-invalid' },
) {
  override get message(): string {
    return 'Activity state is invalid; it was left untouched.'
  }
}

export class ActivityStateWriteFailed extends Schema.TaggedError<ActivityStateWriteFailed>()(
  'ActivityStateWriteFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'activity-failed' },
) {
  override get message(): string {
    return 'Activity state could not be written.'
  }
}

export type ActivityStoreReadError = ActivityStateUnreadable | ActivityStateInvalid

export interface IngestResult {
  readonly event: ActivityEvent
  readonly duplicate: boolean
}

export interface ActivityStoreOptions {
  readonly statePath?: string
  readonly maxEvents?: number
}

interface CachedState {
  readonly revision: string
  readonly at: number
  readonly state: ActivityState
}

const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(activityStateSchema), { onExcessProperty: 'error' })
const encodeState = Schema.encodeEffect(Schema.fromJsonString(activityStateSchema))

const initialState = (now: number): ActivityState => ({ schemaVersion: 1, events: [], ingestCount: 0, duplicateCount: 0, startedAt: now })

/** The identity a snapshot is validated against: file metadata plus this process's own write counter. */
const revisionOf = (info: FileSystem.File.Info, writeRevision: number): string =>
  [
    String(info.dev),
    String(Option.getOrElse(info.ino, () => 0n)),
    String(info.size),
    String(Option.match(info.mtime, { onNone: () => 0, onSome: mtime => mtime.getTime() })),
    String(writeRevision),
  ].join(':')

const isNotFound = (error: PlatformError.PlatformError): boolean => error.reason._tag === 'NotFound'

const defaultStatePath = Effect.gen(function* () {
  const path = yield* Path.Path
  const home = yield* Config.option(Config.NonEmptyString('DSH_HOME'))
  const root = Option.match(home, { onNone: () => path.join(homedir(), '.dsh'), onSome: value => value.trim() })
  return path.join(root, 'runtime', 'dshfiles', 'activity-timeline', 'state.json')
})

const make = Effect.fnUntraced(function* (options: ActivityStoreOptions) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const statePath = options.statePath ?? (yield* defaultStatePath)
  const maxEvents = Math.max(100, Math.min(MAX_EVENTS, options.maxEvents ?? MAX_EVENTS))
  const cache = yield* Ref.make(Option.none<CachedState>())
  const writeRevision = yield* Ref.make(0)
  const writeLock = yield* Semaphore.make(1)

  const statOf = fs.stat(statePath).pipe(
    Effect.map(Option.some),
    Effect.catchIf(isNotFound, () => Effect.succeedNone),
    Effect.mapError(cause => new ActivityStateUnreadable({ cause })),
  )

  const read = Effect.fn('activity store read')(function* () {
    const now = yield* Clock.currentTimeMillis
    const info = yield* statOf
    if (Option.isNone(info)) {
      yield* Ref.set(cache, Option.none())
      return initialState(now)
    }
    const revision = revisionOf(info.value, yield* Ref.get(writeRevision))
    const cached = yield* Ref.get(cache)
    if (Option.isSome(cached) && cached.value.revision === revision && now - cached.value.at < STATE_FRESHNESS_MS) return cached.value.state
    const text = yield* fs.readFileString(statePath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeedNone),
      Effect.mapError(cause => new ActivityStateUnreadable({ cause })),
    )
    if (Option.isNone(text)) return initialState(now)
    const state = yield* decodeState(text.value).pipe(Effect.mapError(cause => new ActivityStateInvalid({ cause })))
    yield* Ref.set(cache, Option.some({ revision, at: now, state }))
    return state
  })

  const write = Effect.fn('activity store write')(function* (state: ActivityState) {
    const text = yield* encodeState(state).pipe(Effect.mapError(cause => new ActivityStateWriteFailed({ cause })))
    const temporaryPath = `${statePath}.tmp-${yield* Effect.sync(randomUUID)}`
    yield* fs.makeDirectory(path.dirname(statePath), { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(fs.writeFileString(temporaryPath, `${text}\n`, { mode: 0o600 })),
      Effect.andThen(fs.rename(temporaryPath, statePath)),
      Effect.mapError(cause => new ActivityStateWriteFailed({ cause })),
    )
    // Publish the write into the snapshot, so the read that follows a write costs one stat instead of a full parse.
    const revision = yield* Ref.updateAndGet(writeRevision, current => current + 1)
    const now = yield* Clock.currentTimeMillis
    const info = yield* fs.stat(statePath).pipe(Effect.option)
    yield* Ref.set(
      cache,
      Option.map(info, written => ({ revision: revisionOf(written, revision), at: now, state })),
    )
  })

  /** One serialized batch: duplicate detection, ordering, retention and a single durable write. */
  const ingest = Effect.fn('activity store ingest')(function* (events: ReadonlyArray<ActivityEvent>) {
    yield* Effect.annotateCurrentSpan({ 'activity.events': events.length })
    return yield* writeLock.withPermit(
      Effect.gen(function* () {
        const state = yield* read()
        const byId = new Map(state.events.map(event => [event.id, event]))
        const results: IngestResult[] = []
        const fresh: ActivityEvent[] = []
        for (const event of events) {
          const existing = byId.get(event.id)
          if (existing !== undefined) {
            results.push({ event: existing, duplicate: true })
            continue
          }
          byId.set(event.id, event)
          fresh.push(event)
          results.push({ event, duplicate: false })
        }
        const duplicates = results.length - fresh.length
        if (fresh.length === 0) {
          if (duplicates > 0) yield* write({ ...state, duplicateCount: state.duplicateCount + duplicates })
          return results
        }
        const merged = [...state.events, ...fresh].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)).slice(-maxEvents)
        yield* write({ ...state, events: merged, ingestCount: state.ingestCount + fresh.length, duplicateCount: state.duplicateCount + duplicates })
        return results
      }),
    )
  })

  return ActivityStore.of({ read: read(), ingest })
})

/** The durable activity window: one JSON document, cached by revision, written atomically under one lock. */
export class ActivityStore extends Context.Service<
  ActivityStore,
  {
    readonly read: Effect.Effect<ActivityState, ActivityStoreReadError>
    readonly ingest: (events: ReadonlyArray<ActivityEvent>) => Effect.Effect<ReadonlyArray<IngestResult>, ActivityStoreReadError | ActivityStateWriteFailed>
  }
>()('@dshfiles/activity-timeline/ActivityStore') {
  static readonly layerWith = (options: ActivityStoreOptions) => Layer.effect(ActivityStore, make(options))
  static readonly layer = ActivityStore.layerWith({})
}
