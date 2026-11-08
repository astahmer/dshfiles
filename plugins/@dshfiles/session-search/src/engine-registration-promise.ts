import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema } from 'effect'

import { SessionSearchEngine } from './engine.js'
import { SearchWorker } from './worker-client.js'
import { SearchWorkerPort } from './worker-port-promise.js'

export class EngineStartFailed extends Schema.TaggedError<EngineStartFailed>()('EngineStartFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'The owned session-search backend did not start; the Host log has its cause. Restart the DSH host process to retry.'
  }
}

/**
 * Registers the owned engine as the process's `sessionQuery` service. Core's `SessionQueryEngine` is a Promise Cordis
 * plugin, so this edge adapts the worker to it and reports whether this activation's engine won the service.
 */
export class SessionQueryOwnership extends Context.Service<
  SessionQueryOwnership,
  {
    /** True when the engine serving `sessionQuery` now is the one this activation registered. */
    readonly owned: Effect.Effect<boolean>
    readonly started: boolean
  }
>()('@dshfiles/session-search/SessionQueryOwnership') {
  static readonly layer = (options: { readonly preparedSessionCacheSize?: number } = {}) =>
    Layer.effect(
      SessionQueryOwnership,
      Effect.gen(function* () {
        const host = yield* HostContext
        const worker = yield* SearchWorker
        const port = new SearchWorkerPort({
          searchSessions: yield* DshxPlugin.callback(worker.searchSessions),
          searchEvents: yield* DshxPlugin.callback(worker.searchEvents),
          health: yield* DshxPlugin.callback(() => worker.health),
        })
        const engine = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              host.ctx.plugin(SessionSearchEngine, {
                client: port,
                ...(options.preparedSessionCacheSize === undefined ? {} : { preparedSessionCacheSize: options.preparedSessionCacheSize }),
              }),
            catch: cause => new EngineStartFailed({ cause }),
          }),
          registered => Effect.sync(() => registered.dispose()),
        ).pipe(
          Effect.as(true),
          Effect.catchTag('EngineStartFailed', error =>
            Effect.logError('session-search: the owned search backend did not start', error).pipe(Effect.as(false)),
          ),
        )
        const owned = Effect.sync(() => {
          const service = host.ctx.get('sessionQuery')
          return service instanceof SessionSearchEngine && service._client === port
        })
        return SessionQueryOwnership.of({ owned, started: engine })
      }),
    )
}
