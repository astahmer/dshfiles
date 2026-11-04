import type {} from '@deepseek-ai/dsh-subprocess'
import { HostContext, hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import { HostCallFailed } from './errors.js'

/** Absolute paths of the executables this plugin spawns besides jj, resolved by DSH's subprocess runtime. */
export class Executables extends Context.Service<Executables, { readonly resolve: (name: string) => Effect.Effect<string, HostCallFailed> }>()(
  '@dshfiles/jj-integration/Executables',
) {
  static readonly layer = Layer.effect(
    Executables,
    Effect.gen(function* () {
      const host = yield* HostContext
      const subprocess = Effect.provideService(hostService('subprocess'), HostContext, host)
      return Executables.of({
        resolve: Effect.fn('executable resolve')(function* (name: string) {
          const runtime = yield* subprocess.pipe(Effect.mapError(cause => new HostCallFailed({ service: 'subprocess runtime', operation: 'start', cause })))
          return yield* Effect.tryPromise({
            try: signal => runtime.resolveExecutable(name, undefined, signal),
            catch: cause => new HostCallFailed({ service: 'subprocess runtime', operation: `find ${name}`, cause }),
          })
        }),
      })
    }),
  )

  /** Resolve names as given, for tests whose spawner looks them up on PATH itself. */
  static readonly layerAsGiven = Layer.succeed(Executables, Executables.of({ resolve: name => Effect.succeed(name) }))
}
