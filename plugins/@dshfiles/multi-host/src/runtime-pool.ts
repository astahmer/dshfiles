import { Clock, Context, DateTime, Duration, Effect, Layer, Path, PubSub, RcMap, Ref, Schema, type Scope, Stream } from 'effect'
import { Connectors } from './connectors/connectors.js'
import type { Gateway } from './connectors/gateway.js'
import { failureCodeOf, GatewayUnreachable, HostNotFound, isTransportFailure, RuntimeNotFound } from './errors.js'
import { HostDirectory } from './host-directory.js'
import { RemoteIdentity } from './remote-identity.js'

const idleTimeToLive = Duration.minutes(5)
const unreachableCooldown = Duration.seconds(30)
const isGatewayUnreachable = Schema.is(GatewayUnreachable)

/** One pooled connection: the gateway and the generation that tells a replaced connection from its successor. */
export interface RuntimeLease {
  readonly gateway: Gateway
  readonly generation: number
}

export interface ConnectionError {
  readonly code: string
  readonly message: string
  readonly at: string
}

type Lookup = Effect.Effect<RuntimeLease, Effect.Error<ReturnType<Connectors['Service']['connect']>> | LookupError, Scope.Scope>
type LookupError =
  | RuntimeNotFound
  | HostNotFound
  | Effect.Error<ReturnType<HostDirectory['Service']['findRuntime']>>
  | Effect.Error<ReturnType<HostDirectory['Service']['upsertRuntime']>>
  | Effect.Error<ReturnType<typeof RemoteIdentity.verifyPinned>>

export type PoolError = Effect.Error<Lookup>

const isTaggedFailure = Schema.is(Schema.Struct({ _tag: Schema.String }))

const errorText = (error: unknown): { readonly code: string; readonly message: string } =>
  error instanceof Error && isTaggedFailure(error)
    ? { code: failureCodeOf(error), message: error.message }
    : { code: 'runtime-unavailable', message: 'The runtime request failed. Check the host status and reconnect if needed.' }

/**
 * One live, identity-verified connection per runtime, shared by every caller until it idles out for five minutes or
 * its transport drops. A read that fails because the connection dropped retries once on a fresh one; a mutation
 * never does, so an admitted mutation is not replayed. A runtime that could not be reached is not dialled again for
 * thirty seconds: every caller in between gets the same failure at once instead of its own connect timeout. An
 * explicit reconnect (`clearError`) ends the pause.
 */
export class RuntimePool extends Context.Service<
  RuntimePool,
  {
    readonly use: <A, E, R>(
      runtimeId: string,
      request: (gateway: Gateway) => Effect.Effect<A, E, R>,
      options: { readonly mutation: boolean },
    ) => Effect.Effect<A, E | PoolError, R>
    /** Hold the runtime's connection for the Scope. */
    readonly acquire: (runtimeId: string) => Effect.Effect<RuntimeLease, PoolError, Scope.Scope>
    /** Drop the connection, unless `generation` names one a newer connection already replaced. */
    readonly invalidate: (runtimeId: string, generation?: number) => Effect.Effect<void>
    /** The live connection's generation, if one is open. */
    readonly generation: (runtimeId: string) => Effect.Effect<number | undefined>
    readonly lastError: (runtimeId: string) => Effect.Effect<ConnectionError | undefined>
    readonly clearError: (runtimeId: string) => Effect.Effect<void>
    /** Every runtime id the moment a fresh connection to it is verified. */
    readonly connected: Stream.Stream<string>
    /** Every runtime id whose connection opened or closed, or whose last error was recorded or cleared. */
    readonly changes: Stream.Stream<string>
  }
>()('@dshfiles/multi-host/RuntimePool') {
  static readonly layer = Layer.effect(
    RuntimePool,
    Effect.gen(function* () {
      const connectors = yield* Connectors
      const directory = yield* HostDirectory
      const path = yield* Path.Path
      const generations = yield* Ref.make(new Map<string, number>())
      const errors = yield* Ref.make(new Map<string, ConnectionError>())
      const connections = yield* PubSub.unbounded<string>()
      const changed = yield* PubSub.unbounded<string>()
      const nextGeneration = yield* Ref.make(1)
      const unreachable = yield* Ref.make(new Map<string, { readonly until: number; readonly error: GatewayUnreachable }>())

      const recordError = (runtimeId: string, error: unknown) =>
        Effect.flatMap(DateTime.now, now =>
          Ref.update(errors, current => new Map(current).set(runtimeId, { ...errorText(error), at: DateTime.formatIso(now) })),
        ).pipe(Effect.andThen(PubSub.publish(changed, runtimeId)))
      const clearError = (runtimeId: string) =>
        Ref.update(unreachable, current => {
          if (!current.has(runtimeId)) return current
          const next = new Map(current)
          next.delete(runtimeId)
          return next
        }).pipe(
          Effect.andThen(
            Ref.modify(errors, current => {
              if (!current.has(runtimeId)) return [false, current] as const
              const next = new Map(current)
              next.delete(runtimeId)
              return [true, next] as const
            }),
          ),
          Effect.flatMap(cleared => (cleared ? PubSub.publish(changed, runtimeId) : Effect.void)),
        )

      const leases: RcMap.RcMap<string, RuntimeLease, PoolError> = yield* RcMap.make({
        lookup: (runtimeId: string): Lookup =>
          Effect.gen(function* () {
            const runtime = yield* directory.findRuntime(runtimeId)
            if (runtime === undefined) return yield* new RuntimeNotFound({ runtimeId })
            const host = yield* directory.findHost(runtime.hostId)
            if (host === undefined) return yield* new HostNotFound({ hostId: runtime.hostId })
            // A stable origin port keeps the browser cookie of an opened remote view valid across reconnects.
            const gateway = yield* connectors.connect({ host, runtime, originPort: runtime.originPort })
            const identity = yield* RemoteIdentity.verifyPinned({ gateway, runtime }).pipe(Effect.provideService(Path.Path, path))
            yield* directory.upsertRuntime({ ...runtime, identity, lastSeenAt: DateTime.formatIso(yield* DateTime.now) })
            const generation = yield* Ref.getAndUpdate(nextGeneration, value => value + 1)
            yield* Effect.acquireRelease(
              Ref.update(generations, current => new Map(current).set(runtimeId, generation)).pipe(Effect.andThen(PubSub.publish(changed, runtimeId))),
              () =>
                Ref.modify(generations, current => {
                  if (current.get(runtimeId) !== generation) return [false, current] as const
                  const next = new Map(current)
                  next.delete(runtimeId)
                  return [true, next] as const
                }).pipe(Effect.flatMap(closed => (closed ? PubSub.publish(changed, runtimeId) : Effect.void))),
            )
            yield* clearError(runtimeId)
            yield* PubSub.publish(connections, runtimeId)
            // A transport that goes away on its own retires the connection, unless a newer one already replaced it.
            yield* Effect.forkScoped(Effect.andThen(gateway.closed, invalidate(runtimeId, generation)))
            return { gateway, generation }
          }).pipe(Effect.withSpan('multi-host runtime pool connect', { attributes: { 'dshx.multi-host.runtime_id': runtimeId } })),
        idleTimeToLive,
      })

      const invalidate = (runtimeId: string, generation?: number): Effect.Effect<void> =>
        Effect.flatMap(Ref.get(generations), current =>
          generation !== undefined && current.get(runtimeId) !== generation ? Effect.void : RcMap.invalidate(leases, runtimeId),
        )

      const pauseUnreachable = (runtimeId: string, error: unknown) =>
        isGatewayUnreachable(error)
          ? Effect.flatMap(Clock.currentTimeMillis, now =>
              Ref.update(unreachable, current => new Map(current).set(runtimeId, { until: now + Duration.toMillis(unreachableCooldown), error })),
            )
          : Effect.void

      /** A failed connect is not cached as a lease: the next caller connects again, after the unreachable pause. */
      const acquire = (runtimeId: string) =>
        Effect.gen(function* () {
          const paused = (yield* Ref.get(unreachable)).get(runtimeId)
          if (paused !== undefined && (yield* Clock.currentTimeMillis) < paused.until) return yield* paused.error
          return yield* RcMap.get(leases, runtimeId).pipe(
            Effect.tapError(error => RcMap.invalidate(leases, runtimeId).pipe(Effect.andThen(pauseUnreachable(runtimeId, error)))),
          )
        })

      const use = <A, E, R>(runtimeId: string, request: (gateway: Gateway) => Effect.Effect<A, E, R>, options: { readonly mutation: boolean }) => {
        const once = Effect.scoped(
          Effect.flatMap(acquire(runtimeId), lease =>
            request(lease.gateway).pipe(Effect.tapError(error => (isTransportFailure(error) ? invalidate(runtimeId, lease.generation) : Effect.void))),
          ),
        )
        const attempts = options.mutation ? once : once.pipe(Effect.retry({ times: 1, while: isTransportFailure }))
        return attempts.pipe(Effect.tapError(error => recordError(runtimeId, error)))
      }

      return RuntimePool.of({
        use,
        acquire,
        invalidate,
        generation: runtimeId => Effect.map(Ref.get(generations), current => current.get(runtimeId)),
        lastError: runtimeId => Effect.map(Ref.get(errors), current => current.get(runtimeId)),
        clearError,
        connected: Stream.fromPubSub(connections),
        changes: Stream.fromPubSub(changed),
      })
    }),
  )
}
