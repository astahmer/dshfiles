import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { type Duration, Effect, FileSystem, Path, Schema } from 'effect'
import { SessionStore } from './session-store-promise.js'

const progressSchema = Schema.Struct({ complete: Schema.Boolean, settled: Schema.Array(Schema.String) })
const decodeProgress = Schema.decodeUnknownEffect(Schema.fromJsonString(progressSchema))
const encodeProgress = Schema.encodeEffect(Schema.fromJsonString(progressSchema))

/**
 * A former 14-day prune deleted the projection checkpoints of every idle Session, so a cold Session lost the list
 * metadata and title the checkpoint serves without reading its log. This pass rebuilds each missing checkpoint once,
 * through the cache's own `coldSnapshot`, which folds a complete log and writes the refreshed checkpoint back. It reads
 * one log at a time, pauses between logs, and records the Sessions it settled so a restart resumes where it stopped;
 * once a pass completes it never runs again, because new Sessions get their checkpoint from the cache itself.
 */
export class ProjectionCacheRebuild {
  /** `coldSnapshot` needs the whole decoded log on the Host thread; a larger log waits until someone opens it. */
  static readonly maxLogBytes = 8 * 1024 * 1024

  /** How many settled Sessions a restart may check again: the progress file is rewritten once per this many. */
  static readonly saveEvery = 25

  static readonly run = Effect.fn('projection cache rebuild')(function* (input: {
    readonly ctx: Context
    readonly progressPath: string
    readonly pause: Duration.Input
    readonly maxLogBytes?: number
  }) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const persistence = input.ctx.get('sessionPersistence')
    const cache = input.ctx.get('sessionProjectionCache')
    if (persistence === undefined || cache === undefined) return { rebuilt: 0 }
    const saved = yield* fs.readFileString(input.progressPath).pipe(
      Effect.flatMap(decodeProgress),
      Effect.orElseSucceed(() => ({ complete: false, settled: [] })),
    )
    if (saved.complete) return { rebuilt: 0 }
    const settled = new Set(saved.settled)
    const save = (complete: boolean) =>
      Effect.gen(function* () {
        const text = yield* encodeProgress({ complete, settled: complete ? [] : [...settled] })
        yield* fs.makeDirectory(path.dirname(input.progressPath), { recursive: true })
        yield* fs.writeFileString(input.progressPath, text)
      })
    const maxLogBytes = input.maxLogBytes ?? ProjectionCacheRebuild.maxLogBytes
    const isLive = (id: SessionId) => input.ctx.get('sessions')?.get(id) !== undefined
    const needsCheckpoint = (snapshot: SessionPersistenceSnapshot) =>
      snapshot.formatStatus !== 'migration-required' &&
      snapshot.sizeBytes !== undefined &&
      snapshot.sizeBytes <= maxLogBytes &&
      !isLive(snapshot.header.id) &&
      cache.cachedSnapshot(snapshot.header) === undefined

    let rebuilt = 0
    let unsaved = 0
    for (const snapshot of yield* SessionStore.list(persistence)) {
      const id = snapshot.header.id
      if (settled.has(id)) continue
      yield* Effect.yieldNow
      if (needsCheckpoint(snapshot)) {
        const done = yield* SessionStore.inspect(persistence, id).pipe(
          Effect.flatMap(log =>
            // A Session opened during the read checkpoints itself from its live state.
            isLive(id)
              ? Effect.succeed(false)
              : Effect.sync(() => {
                  cache.coldSnapshot(log.meta, log.inheritedEventCount, log.events)
                  return true
                }),
          ),
          Effect.catchCause(cause =>
            Effect.as(Effect.logWarning('session-search: a projection checkpoint could not be rebuilt', { sessionId: id, cause }), false),
          ),
        )
        if (done) rebuilt += 1
        yield* Effect.sleep(input.pause)
      }
      settled.add(id)
      unsaved += 1
      if (unsaved >= ProjectionCacheRebuild.saveEvery) {
        yield* save(false)
        unsaved = 0
      }
    }
    yield* save(true)
    return { rebuilt }
  })
}
