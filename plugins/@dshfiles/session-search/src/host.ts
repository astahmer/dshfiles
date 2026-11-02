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
import { SessionQueryOwnership } from './engine-registration-promise.js'
import type { IndexHealth } from './protocol.js'
import { SearchWorker } from './worker-client.js'

/** A Loader row may omit either index setting, so both keys stay optional. */
const rowConfig = Schema.UndefinedOr(
  Schema.Struct({
    indexPath: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
    windowBytes: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))),
  }),
)

/** A row with no `config` key arrives as `undefined`; the defaults fill it instead of failing activation. */
export const Config = Schema.toStandardSchemaV1(rowConfig)

const persistenceConfig = Schema.decodeUnknownOption(Schema.Struct({ config: Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }) }))

/** A committed Session event wakes the ingest loop, coalesced so a busy turn does not wake it per event. */
const NUDGE_DEBOUNCE = '500 millis'

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
  SessionQueryOwnership.layer.pipe(
    Layer.provideMerge(
      SearchWorker.layer({
        indexPath: config?.indexPath ?? dshHomePath('plugins', 'session-search', 'index.sqlite'),
        windowBytes: config?.windowBytes,
      }),
    ),
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
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
    yield* worker.startIngest(root).pipe(Effect.catchCause(cause => Effect.logWarning('session-search: ingest could not start', cause)))
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
