import type { JsonValue } from '@dshfiles/dshx/platform'
import { Cause, type Context, Effect, Exit, type Path, Schema, SchemaAST, Scope, Stream } from 'effect'
import { Connectors } from './connectors/connectors.js'
import type { Gateway as EffectGateway } from './connectors/gateway.js'
import { HostDirectory } from './host-directory.js'
import { RuntimeIdentity } from './identity.js'
import { LaunchFile } from './launch-file.js'
import type { MultiHostPaths } from './paths.js'
import type { HostRecord, RuntimeRecord } from './records.js'
import { RemoteThreads, type RemoteThread } from './remote-threads.js'
import type { Ssh } from './ssh.js'
import { GatewayUnreachable } from './errors.js'
import { RemoteIdentity } from './remote-identity.js'
import { RuntimePool } from './runtime-pool.js'
import type { ResourcePool, RuntimeStatus } from './runtime-status.js'
import type { ViewLeases } from './view-leases.js'

/**
 * The Effect services the remaining Promise handlers reach while the Host moves onto `DshxPlugin.make`; installed for
 * the plugin activation and removed with it.
 */
export type LegacyServices =
  | Ssh
  | MultiHostPaths
  | HostDirectory
  | RemoteThreads
  | RuntimeIdentity
  | LaunchFile
  | Connectors
  | RuntimePool
  | Path.Path
  | RuntimeStatus
  | ResourcePool
  | ViewLeases

export class GatewayUnavailableError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GatewayUnavailableError'
  }
}

export type GatewayOutcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: string; readonly message: string }

/** The Promise shape the pool, the session source and the remaining handlers still use. */
export type Gateway = {
  readonly origin: string
  readonly launchUrl: string
  readonly closed: Promise<void>
  run(namespace: string, method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  runSafe(namespace: string, method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<GatewayOutcome>
  api(method: string, input?: JsonValue, signal?: AbortSignal): Promise<unknown>
  pluginApi(target: {
    readonly packageId: string
    readonly apiId: string
    readonly version: number
  }): (method: string, input?: JsonValue, signal?: AbortSignal) => Promise<unknown>
  follow(endpoint: string, args: unknown, timeoutMs: number, signal?: AbortSignal): Promise<readonly unknown[]>
  stream(endpoint: string, args: unknown, signal: AbortSignal): AsyncIterable<unknown>
  dispose(): Promise<void>
}

const wireCodeAt = SchemaAST.resolveAt<string>('dshxWireCode')

/** The code and message a value handler reports for a failure: a remote failure keeps the runtime's own code. */
const failureOf = (error: unknown): { readonly code: string; readonly message: string } => {
  if (typeof error === 'object' && error !== null && Schema.isSchema(error.constructor) && error instanceof Error) {
    if ('code' in error && typeof error.code === 'string') return { code: error.code, message: error.message }
    const code = wireCodeAt(error.constructor.ast)
    if (code !== undefined) return { code, message: error.message }
  }
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return { code: error.code, message: error.message }
  return { code: 'runtime-unavailable', message: 'The runtime request failed. Check the host status and reconnect if needed.' }
}

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

const readOrCreateRuntimeIdentity = () => run(RuntimeIdentity.use(service => service.current))

const publishLaunchFile = (launchUrl: string) => open(LaunchFile.use(service => service.publish(launchUrl)))

const aborted = (signal: AbortSignal) =>
  Effect.callback<void>(resume => {
    if (signal.aborted) return resume(Effect.void)
    const onAbort = () => resume(Effect.void)
    signal.addEventListener('abort', onAbort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', onAbort))
  })

/** Gateway effects need no services, so they run whether or not the plugin installed its own. */
const runStandalone = async <A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect, signal === undefined ? undefined : { signal })
  if (Exit.isSuccess(exit)) return exit.value
  throw thrown(exit.cause)
}

const toPromiseGateway = (input: { readonly gateway: EffectGateway; readonly close: () => Promise<void> }): Gateway => {
  const gateway = input.gateway
  const runNative = (namespace: string, method: string, args: Record<string, unknown>, signal?: AbortSignal) =>
    runStandalone(gateway.run({ namespace, method, args }), signal)
  const pluginApi: Gateway['pluginApi'] = target => {
    const call = gateway.pluginApi(target)
    return (method, value, signal) => runStandalone(call(method, value), signal)
  }
  return {
    origin: gateway.origin,
    launchUrl: gateway.launchUrl,
    closed: Effect.runPromise(gateway.closed),
    run: runNative,
    runSafe: (namespace, method, args, signal) =>
      runNative(namespace, method, args, signal).then(
        (value): GatewayOutcome => ({ ok: true, value }),
        (error: unknown): GatewayOutcome => ({ ok: false, ...failureOf(error) }),
      ),
    api: (method, value, signal) => runStandalone(gateway.api(method, value), signal),
    pluginApi,
    follow: (endpoint, args, timeoutMs, signal) => runStandalone(gateway.follow({ endpoint, args, timeout: timeoutMs }), signal),
    stream: (endpoint, args, signal) => Stream.toAsyncIterable(gateway.stream({ endpoint, args }).pipe(Stream.interruptWhen(aborted(signal)))),
    dispose: input.close,
  }
}

/** An unpooled gateway to a runtime that is not registered yet; `close` ends its connection Scope. */
const connectRuntime = async (input: Parameters<Connectors['Service']['connect']>[0], signal?: AbortSignal) => {
  const opened = await open(
    Connectors.use(connectors => connectors.connect(input)),
    signal,
  )
  return { gateway: opened.value, close: opened.close }
}

const readIdentity = (gateway: EffectGateway) => run(RemoteIdentity.read(gateway))

const servicesSync = <A>(effect: Effect.Effect<A, never, LegacyServices>): A => Effect.runSyncWith(servicesOrThrow())(effect)

const pooledAdapter = (gateway: EffectGateway) => toPromiseGateway({ gateway, close: async () => undefined })

const rethrown = (error: unknown): unknown => error

/**
 * The pooled request of a Promise handler. `broken` lets a request that reports transport failures as values still
 * retire the connection (and retry a read once), returning its last value instead of failing.
 */
const withRuntime = async <Result>(
  runtimeId: string,
  request: (gateway: Gateway) => Promise<Result>,
  options: { readonly mutation: boolean; readonly broken?: (result: Result) => boolean },
): Promise<Result> => {
  const brokenMarker = new GatewayUnreachable()
  const last: { result?: { readonly value: Result } } = {}
  return run(
    RuntimePool.use(pool =>
      pool.use(
        runtimeId,
        gateway =>
          Effect.tryPromise({ try: () => request(pooledAdapter(gateway)), catch: rethrown }).pipe(
            Effect.flatMap(result => {
              if (options.broken?.(result) !== true) return Effect.succeed(result)
              last.result = { value: result }
              return Effect.fail(brokenMarker)
            }),
          ),
        { mutation: options.mutation },
      ),
    ).pipe(
      Effect.catchIf(
        error => error === brokenMarker,
        () => (last.result === undefined ? Effect.fail(brokenMarker) : Effect.succeed(last.result.value)),
      ),
    ),
  )
}

/** A held pool connection with the old lease shape: `release` ends the hold. */
const acquire = async (runtimeId: string) => {
  const opened = await open(RuntimePool.use(pool => pool.acquire(runtimeId)))
  return { gateway: pooledAdapter(opened.value.gateway), generation: opened.value.generation, release: () => void opened.close() }
}

const pool = {
  withRuntime,
  acquire,
  status: (runtimeId: string) => {
    const generation = servicesSync(RuntimePool.use(service => service.generation(runtimeId)))
    return generation === undefined ? undefined : { connected: true, generation }
  },
  lastError: (runtimeId: string) => servicesSync(RuntimePool.use(service => service.lastError(runtimeId))),
  clearError: (runtimeId: string) => run(RuntimePool.use(service => service.clearError(runtimeId))),
  close: (runtimeId: string) => run(RuntimePool.use(service => service.invalidate(runtimeId))),
}

export class LegacyRuntime {
  static readonly install = install
  static readonly run = run
  static readonly open = open
  static readonly failureOf = failureOf
  static readonly toPromiseGateway = toPromiseGateway
  static readonly connectRuntime = connectRuntime
  static readonly readIdentity = readIdentity
  static readonly pool = pool
  static readonly readOrCreateRuntimeIdentity = readOrCreateRuntimeIdentity
  static readonly publishLaunchFile = publishLaunchFile
}
