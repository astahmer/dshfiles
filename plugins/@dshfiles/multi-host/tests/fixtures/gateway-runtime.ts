import { Effect, Exit, ManagedRuntime, Scope } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { connectGateway, type Gateway } from '../../src/connectors/gateway.js'

/** A gateway straight to a loopback runtime fixture, open until `close`; `call` runs an Effect in its Scope. */
export const openGateway = async (launchUrl: string) => {
  const runtime = ManagedRuntime.make(FetchHttpClient.layer)
  const scope = await runtime.runPromise(Scope.make())
  const gateway: Gateway = await runtime.runPromise(
    Scope.provide(scope)(connectGateway({ launchUrl, transport: origin => Effect.succeed({ origin: origin.origin, launchUrl, closed: Effect.never }) })),
  )
  const call = <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(Scope.provide(scope)(effect))
  const close = async () => {
    await runtime.runPromise(Scope.close(scope, Exit.void))
    await runtime.dispose()
  }
  return { gateway, call, close }
}
