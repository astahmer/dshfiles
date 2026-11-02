import { Cause, type Context, Effect, Exit, Scope } from 'effect'
import { GatewayUnavailableError } from './connectors/gateway.js'
import type { Ssh } from './ssh.js'

/**
 * The Effect services the remaining Promise handlers reach while the Host moves onto `DshxPlugin.make`; installed for
 * the plugin activation and removed with it.
 */
type LegacyServices = Ssh

const installed: { services: Context.Context<LegacyServices> | undefined } = { services: undefined }

const install = Effect.acquireRelease(
  Effect.flatMap(Effect.context<LegacyServices>(), services =>
    Effect.sync(() => {
      installed.services = services
    }),
  ),
  () =>
    Effect.sync(() => {
      installed.services = undefined
    }),
)

const servicesOrThrow = (): Context.Context<LegacyServices> => {
  if (installed.services === undefined) throw new GatewayUnavailableError('runtime-unavailable', 'The multi-host plugin is not active.')
  return installed.services
}

const thrown = (cause: Cause.Cause<unknown>): unknown =>
  Cause.hasInterruptsOnly(cause) ? new GatewayUnavailableError('cancelled', 'The request was cancelled.') : Cause.squash(cause)

const run = async <A, E>(effect: Effect.Effect<A, E, LegacyServices>, signal?: AbortSignal): Promise<A> => {
  const exit = await Effect.runPromiseExitWith(servicesOrThrow())(effect, signal === undefined ? undefined : { signal })
  if (Exit.isSuccess(exit)) return exit.value
  throw thrown(exit.cause)
}

/** Run a scoped effect whose Scope outlives the call; `close` ends it. A failed run closes its Scope at once. */
const open = async <A, E>(
  effect: Effect.Effect<A, E, LegacyServices | Scope.Scope>,
  signal?: AbortSignal,
): Promise<{ readonly value: A; readonly close: () => Promise<void> }> => {
  const scope = Scope.makeUnsafe()
  const exit = await Effect.runPromiseExitWith(servicesOrThrow())(Scope.provide(scope)(effect), signal === undefined ? undefined : { signal })
  if (Exit.isSuccess(exit)) return { value: exit.value, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
  await Effect.runPromise(Scope.close(scope, exit))
  throw thrown(exit.cause)
}

export class LegacyRuntime {
  static readonly install = install
  static readonly run = run
  static readonly open = open
}
