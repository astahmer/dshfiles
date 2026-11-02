import { Cause, type Context, Effect, Exit, Scope } from 'effect'
import { GatewayUnavailableError } from './connectors/gateway.js'
import { HostDirectory } from './host-directory.js'
import { RuntimeIdentity } from './identity.js'
import { LaunchFile } from './launch-file.js'
import type { MultiHostPaths } from './paths.js'
import type { HostRecord, RuntimeRecord } from './records.js'
import { RemoteThreads, type RemoteThread } from './remote-threads.js'
import type { Ssh } from './ssh.js'

/**
 * The Effect services the remaining Promise handlers reach while the Host moves onto `DshxPlugin.make`; installed for
 * the plugin activation and removed with it.
 */
export type LegacyServices = Ssh | MultiHostPaths | HostDirectory | RemoteThreads | RuntimeIdentity | LaunchFile

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

const thrown = (cause: Cause.Cause<unknown>): Error => {
  if (Cause.hasInterruptsOnly(cause)) return new GatewayUnavailableError('cancelled', 'The request was cancelled.')
  const squashed = Cause.squash(cause)
  return squashed instanceof Error ? squashed : new GatewayUnavailableError('runtime-unavailable', 'The runtime request failed.')
}

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

const directory = <A, E>(body: (service: HostDirectory['Service']) => Effect.Effect<A, E>) => run(HostDirectory.use(body))
const threads = <A, E>(body: (service: RemoteThreads['Service']) => Effect.Effect<A, E>) => run(RemoteThreads.use(body))

export class LegacyRuntime {
  static readonly install = install
  static readonly run = run
  static readonly open = open
}

export class HostDirectoryStore {
  static readonly readDirectory = () => directory(service => service.read)
  static readonly listHosts = () => directory(service => service.listHosts)
  static readonly listRuntimes = (hostId?: string) => directory(service => service.listRuntimes(hostId))
  static readonly findHost = (id: string) => directory(service => service.findHost(id))
  static readonly findRuntime = (id: string) => directory(service => service.findRuntime(id))
  static readonly upsertHost = (record: HostRecord) => directory(service => service.upsertHost(record))
  static readonly setHostHidden = (input: { readonly id: string; readonly hidden: boolean }) => directory(service => service.setHostHidden(input))
  static readonly reorderHosts = (ids: readonly string[]) => directory(service => service.reorderHosts(ids))
  static readonly upsertRuntime = (record: RuntimeRecord) => directory(service => service.upsertRuntime(record))
  static readonly removeRuntime = (id: string) => directory(service => service.removeRuntime(id))
  static readonly removeHost = (id: string, removeDirectory: boolean) => directory(service => service.removeHost({ id, removeDirectory }))
}

export class RemoteThreadStore {
  static readonly list = () => threads(service => service.list)
  static readonly record = (thread: RemoteThread) => threads(service => service.record(thread))
  static readonly forget = (match: { readonly runtimeId: string; readonly sessionId?: string | undefined }) => threads(service => service.forget(match))
}

export const readOrCreateRuntimeIdentity = () => run(RuntimeIdentity.use(service => service.current))

export const publishLaunchFile = (launchUrl: string) => open(LaunchFile.use(service => service.publish(launchUrl)))
