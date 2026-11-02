import { HostContext } from '@dshfiles/dshx/effect'
import { runOutsideReload } from '@dshfiles/dshx/host'
import { Context, Effect, Fiber, Layer } from 'effect'

/**
 * Runs an effect outside the HMR reload transaction the plugin activated in. Every fiber forked during activation
 * inherits that transaction's async context, and DSH refuses a settings write from inside it ("HMR transactions
 * cannot be nested"), so a background loop that writes settings forks its write from here.
 */
export class OutsideReload extends Context.Service<OutsideReload, { readonly run: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E> }>()(
  '@dshfiles/thread-sidebar/OutsideReload',
) {
  static readonly layer = Layer.effect(
    OutsideReload,
    Effect.gen(function* () {
      const host = yield* HostContext
      return OutsideReload.of({
        run: <A, E>(effect: Effect.Effect<A, E>) =>
          Effect.flatMap(Effect.context<never>(), services =>
            Effect.callback<A, E>(resume => {
              const fiber = runOutsideReload(host.ctx, () => Effect.runForkWith(services)(effect))
              fiber.addObserver(exit => resume(exit))
              return Fiber.interrupt(fiber)
            }),
          ),
      })
    }),
  )

  static readonly layerTest = Layer.succeed(OutsideReload, OutsideReload.of({ run: effect => effect }))
}
