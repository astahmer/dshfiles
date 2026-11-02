import { Effect, Exit, ManagedRuntime, Scope } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { connectGateway, type Gateway } from '../../src/connectors/gateway.js'
import { LegacyRuntime } from '../../src/legacy-runtime-promise.js'

/** A gateway straight to a loopback runtime fixture, open until `close`. */
export const openGateway = async (launchUrl: string) => {
  const runtime = ManagedRuntime.make(FetchHttpClient.layer)
  const scope = await runtime.runPromise(Scope.make())
  const gateway: Gateway = await runtime.runPromise(
    Scope.provide(scope)(connectGateway({ launchUrl, transport: origin => Effect.succeed({ origin: origin.origin, launchUrl, closed: Effect.never }) })),
  )
  const close = async () => {
    await runtime.runPromise(Scope.close(scope, Exit.void))
    await runtime.dispose()
  }
  return { gateway, promiseGateway: LegacyRuntime.toPromiseGateway({ gateway, close }), close }
}
