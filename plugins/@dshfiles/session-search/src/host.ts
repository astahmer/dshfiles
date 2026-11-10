/**
 * The bundle entry. It owns the search worker, registers our engine as the process's `sessionQuery` service, and starts
 * the background ingest. One process may own each service, so the stock `@deepseek-ai/dsh-session-query-sqlite` row is
 * disabled by this bundle's own patch (and by the seed profile): while it stays enabled it registers first, wins the
 * service, and silently leaves content search on the read path that freezes the Host.
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Api, DshxPlugin, HostContext, HostEvents } from '@dshfiles/dshx/effect'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer, Option, Schema, Stream } from 'effect'

import { sessionSearchApi } from './api.js'
import { ProjectionCachePrune } from './projection-cache-prune.js'
import { ProjectionCacheRebuild } from './projection-cache-rebuild.js'
import { SessionQueryOwnership } from './engine-registration-promise.js'
import type { IndexHealth } from './protocol.js'
import { SearchWorker } from './worker-client.js'

/** A Loader row may omit either index setting, so both keys stay optional. */
const rowConfig = Schema.UndefinedOr(
  Schema.Struct({
    indexPath: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
    windowBytes: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))),
    // Each prepared cold Session holds its whole decoded log, so this is the profile's memory knob for search.
    preparedSessionCacheSize: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))),
  }),
)

/** A row with no `config` key arrives as `undefined`; the defaults fill it instead of failing activation. */
export const Config = Schema.toStandardSchemaV1(rowConfig)

const persistenceConfig = Schema.decodeUnknownOption(Schema.Struct({ config: Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }) }))

/** A committed Session event wakes the ingest loop, coalesced so a busy turn does not wake it per event. */
const NUDGE_DEBOUNCE = '500 millis'

/** Projection checkpoint upkeep starts after the boot burst, and the rebuild pauses this long between logs. */
const CHECKPOINT_UPKEEP_DELAY = '2 minutes'
const CHECKPOINT_REBUILD_PAUSE = '2 seconds'

const IDLE_HEALTH: IndexHealth = {
  sessions: 0,
  documents: 0,
  indexBytes: 0,
  behindSessions: 0,
  behindBytes: 0,
  ingesting: false,
  lastIngestMs: 0,
  slowestIngestMs: 0,
  lastSearchMs: 0,
  slowestSearchMs: 0,
  lastError: null,
}

const layer = (config: typeof rowConfig.Type) =>
  SessionQueryOwnership.layer(config?.preparedSessionCacheSize === undefined ? {} : { preparedSessionCacheSize: config.preparedSessionCacheSize }).pipe(
    Layer.provideMerge(
      SearchWorker.layer({
        indexPath: config?.indexPath ?? dshHomePath('plugins', 'session-search', 'index.sqlite'),
        windowBytes: config?.windowBytes,
      }),
    ),
    Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  )

const main = Effect.gen(function* () {
  const ownership = yield* SessionQueryOwnership
  const worker = yield* SearchWorker
  const host = yield* HostContext
  if (ownership.started && !(yield* ownership.owned))
    yield* Effect.logError(
      'session-search: another plugin owns the sessionQuery service, so content search stays on it and the owned index is not built; disable the stock @deepseek-ai/dsh-session-query-sqlite row in the profile and restart the DSH host process',
    )
  if (yield* ownership.owned) {
    // The JSONL backend's configured root, else the default `$DSH_HOME/sessions`.
    const root = Option.match(persistenceConfig(host.ctx.get('sessionPersistence')), {
      onNone: () => dshHomePath('sessions'),
      onSome: persistence => persistence.config.root,
    })
    // Archived Sessions are cold: the index keeps no documents for them and reads one back only for a targeted search.
    let lastArchived = ''
    const sendArchived = () =>
      Effect.gen(function* () {
        const registry = host.ctx.get('workspaceRegistry')
        const archived = (registry?.archivedSessionIds ?? []).map(String)
        const signature = archived.join('\u0000')
        if (signature === lastArchived) return
        lastArchived = signature
        yield* worker.setArchived(archived)
      }).pipe(Effect.catchCause(cause => Effect.logWarning('session-search: archived Sessions could not be sent', cause)))
    yield* sendArchived()
    yield* Effect.forever(Effect.andThen(Effect.sleep('10 seconds'), sendArchived())).pipe(Effect.forkChild)
    yield* worker.startIngest(root).pipe(Effect.catchCause(cause => Effect.logWarning('session-search: ingest could not start', cause)))
    // Checkpoint upkeep waits out the boot burst; it lists every stored Session and the rebuild reads one log at a time.
    yield* Effect.gen(function* () {
      yield* Effect.sleep(CHECKPOINT_UPKEEP_DELAY)
      const removed = yield* ProjectionCachePrune.orphans({ ctx: host.ctx }).pipe(
        Effect.catchCause(cause => Effect.as(Effect.logWarning('session-search: orphan projection checkpoints could not be pruned', cause), 0)),
      )
      if (removed > 0) yield* Effect.logInfo('session-search: dropped orphan projection checkpoints', { removed })
      const { rebuilt } = yield* ProjectionCacheRebuild.run({
        ctx: host.ctx,
        progressPath: dshHomePath('plugins', 'session-search', 'checkpoint-rebuild.json'),
        pause: CHECKPOINT_REBUILD_PAUSE,
      })
      if (rebuilt > 0) yield* Effect.logInfo('session-search: rebuilt projection checkpoints', { rebuilt })
    }).pipe(
      Effect.catchCause(cause => Effect.logWarning('session-search: projection checkpoints could not be rebuilt', cause)),
      Effect.forkChild,
    )
  }
  yield* HostEvents.stream('session/event').pipe(
    Stream.debounce(NUDGE_DEBOUNCE),
    Stream.runForEach(() => worker.nudge.pipe(Effect.catchCause(cause => Effect.logWarning('session-search: ingest nudge failed', cause)))),
  )
})

export default DshxPlugin.make({
  name: '@dshfiles/session-search',
  Config: rowConfig,
  inject: ['sessions', 'sessionPersistence'],
  layer,
  main,
  apis: [
    Api.bind(sessionSearchApi, {
      health: () =>
        Effect.gen(function* () {
          // Another plugin owning the service is the failure this index cannot see from inside: say it, and build nothing.
          if (!(yield* (yield* SessionQueryOwnership).owned)) return { ...IDLE_HEALTH, ownsService: false }
          const health = yield* (yield* SearchWorker).health
          return { ...health, ownsService: true }
        }).pipe(Effect.withSpan('session search health')),
    }),
  ],
})
