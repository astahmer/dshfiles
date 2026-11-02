/**
 * The bundle entry. It owns the search worker, registers our engine as the process's `sessionQuery` service, and starts
 * the background ingest. One process may own each service, so the stock `@deepseek-ai/dsh-session-query-sqlite` row is
 * disabled by this bundle's own patch (and by the seed profile): while it stays enabled it registers first, wins the
 * service, and silently leaves content search on the read path that freezes the Host.
 */
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Clock, Context as EffectContext, Duration, Effect, Layer, Queue, Schema } from 'effect'
import { sessionSearchApi } from './api.js'
import { SessionSearchEngine } from './engine.js'
import { withoutUndefined } from './optional-fields.js'
import type { IndexHealth } from './protocol.js'
import { SearchWorkerClient, type SearchWorkerError } from './worker-client.js'

/** A Loader row may omit either index setting, so both keys stay optional. */
const rowConfig = Schema.Struct({
  indexPath: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  windowBytes: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))),
})

/** A row with no `config` key arrives as `undefined`; the defaults fill it instead of failing activation. */
export const Config = Schema.toStandardSchemaV1(Schema.UndefinedOr(rowConfig))

const persistenceConfigSchema = Schema.Struct({ config: Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }) })

/** The JSONL backend's configured root, else the default `$DSH_HOME/sessions`. */
const sessionsRoot = (ctx: Context): string => {
  const parsed = Schema.decodeUnknownResult(persistenceConfigSchema)(ctx.get('sessionPersistence'))
  return parsed._tag === 'Success' ? parsed.success.config.root : dshHomePath('sessions')
}

/** A committed Session event wakes the ingest loop, coalesced so a busy turn does not wake it per event. */
const NUDGE_DEBOUNCE_MS = 500

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

/** The engine that currently backs `sessionQuery`, or nothing — a recomposition can replace or drop this plugin's row. */
const engineOf = (ctx: Context | undefined): SessionSearchEngine | undefined => {
  const service = ctx?.get('sessionQuery')
  return service instanceof SessionSearchEngine ? service : undefined
}

interface SessionSearchRuntime {
  readonly client: SearchWorkerClient
  readonly nudges: Queue.Queue<void>
  readonly engine: () => SessionSearchEngine | undefined
  readonly sessionsRoot: string
}

class SessionSearch extends EffectContext.Service<SessionSearch, SessionSearchRuntime>()('dshfiles/session-search/Runtime') {}

const makeLayer = (ctx: Context, rawConfig: unknown): Layer.Layer<SessionSearch, never, never> => {
  const config = Schema.decodeUnknownSync(Schema.UndefinedOr(rowConfig))(rawConfig) ?? {}
  const indexPath = config.indexPath ?? dshHomePath('plugins', 'session-search', 'index.sqlite')
  return Layer.effect(
    SessionSearch,
    Effect.gen(function* () {
      const nudges = yield* Queue.dropping<void>(1)
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new SearchWorkerClient(
              withoutUndefined({
                indexPath,
                windowBytes: config.windowBytes,
                onError: (error: SearchWorkerError) => ctx.logger.warn(`session-search: ${error.code}: ${error.message}`),
              }),
            ),
        ),
        active => Effect.promise(() => active.close()),
      )
      return { client, nudges, engine: () => engineOf(ctx), sessionsRoot: sessionsRoot(ctx) }
    }),
  )
}

const nudgeLoop = (ctx: Context, active: SessionSearchRuntime) => {
  let lastNudgeAt = 0
  return Effect.forever(
    Effect.gen(function* () {
      yield* Queue.take(active.nudges)
      const now = yield* Clock.currentTimeMillis
      const delay = Math.max(0, NUDGE_DEBOUNCE_MS - (now - lastNudgeAt))
      if (delay > 0) yield* Effect.sleep(Duration.millis(delay))
      yield* Queue.takeAll(active.nudges)
      lastNudgeAt = yield* Clock.currentTimeMillis
      yield* Effect.tryPromise({ try: () => active.client.nudge(), catch: error => error }).pipe(
        Effect.catch(error => Effect.sync(() => ctx.logger.warn(`session-search: ingest nudge failed: ${String(error)}`))),
      )
    }),
  )
}

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: makeLayer,
  setup: (ctx: Context) =>
    Effect.gen(function* () {
      const active = yield* SessionSearch
      const engine = yield* Effect.acquireRelease(
        Effect.tryPromise({ try: () => ctx.plugin(SessionSearchEngine, { client: active.client }), catch: error => error }),
        current => Effect.sync(() => current.dispose()),
      ).pipe(
        Effect.catch(error =>
          Effect.sync(() => {
            ctx.logger.error(`session-search: the owned search backend did not start: ${error instanceof Error ? error.message : String(error)}`)
          }).pipe(Effect.as(undefined)),
        ),
      )
      if (engine !== undefined) {
        const owner = active.engine()
        if (owner === undefined) {
          ctx.logger.error(
            'session-search: another plugin owns the sessionQuery service, so content search stays on it and the owned index is not built; disable the stock @deepseek-ai/dsh-session-query-sqlite row in the profile',
          )
        } else if (owner._client === active.client) {
          yield* Effect.forkScoped(
            Effect.tryPromise({ try: () => active.client.startIngest(active.sessionsRoot), catch: error => error }).pipe(
              Effect.catch(error => Effect.sync(() => ctx.logger.warn(`session-search: ingest could not start: ${String(error)}`))),
            ),
          )
        }
      }
      yield* Effect.sync(() => ctx.on('session/event', () => Queue.offerUnsafe(active.nudges, undefined)))
      yield* Effect.forkScoped(nudgeLoop(ctx, active))
    }),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/session-search',
  Config,
  inject: ['sessions', 'sessionPersistence'],
  apis: [
    hostApi(sessionSearchApi, {
      health: Effect.fn('session search health')(() =>
        Effect.gen(function* () {
          const active = yield* SessionSearch
          const engine = active.engine()
          // Another plugin owning the service is the failure this index cannot see from inside: say it, and build nothing.
          if (engine === undefined) return { ...IDLE_HEALTH, ownsService: false }
          const health = yield* Effect.tryPromise({ try: () => engine._client.health(), catch: error => error })
          return { ...health, ownsService: true }
        }),
      ),
    }),
  ],
})
