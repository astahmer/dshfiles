import { randomUUID } from 'node:crypto'
import { Context, Deferred, Duration, Effect, FiberMap, Layer, Ref } from 'effect'
import { RuntimeNotFound, RuntimeOriginUnavailable } from './errors.js'
import { HostDirectory } from './host-directory.js'
import { RuntimePool, type PoolError, type RuntimeLease } from './runtime-pool.js'

const leaseTimeToLive = Duration.minutes(30)
const maxLeases = 8

interface ViewLease {
  readonly runtimeId: string
  readonly generation: number
  readonly launchUrl: string
}

/**
 * Pooled connections held open for a remote runtime's native view in the browser: one per runtime, at most eight,
 * each released after thirty minutes or when closed. A lease is a fiber holding `RuntimePool.acquire` in its Scope.
 */
export class ViewLeases extends Context.Service<
  ViewLeases,
  {
    readonly open: (
      runtimeId: string,
    ) => Effect.Effect<
      { readonly leaseId: string; readonly launchUrl: string },
      PoolError | RuntimeNotFound | RuntimeOriginUnavailable | Effect.Error<HostDirectory['Service']['findRuntime']>
    >
    readonly close: (leaseId: string) => Effect.Effect<boolean>
    readonly closeRuntime: (runtimeId: string) => Effect.Effect<void>
  }
>()('@dshfiles/multi-host/ViewLeases') {
  static readonly layer = Layer.effect(
    ViewLeases,
    Effect.gen(function* () {
      const pool = yield* RuntimePool
      const directory = yield* HostDirectory
      const fibers = yield* FiberMap.make<string>()
      const leases = yield* Ref.make(new Map<string, ViewLease>())

      const forget = (leaseId: string) =>
        Ref.update(leases, current => {
          const next = new Map(current)
          next.delete(leaseId)
          return next
        })

      const close = Effect.fn('multi-host view lease close')(function* (leaseId: string) {
        const held = (yield* Ref.get(leases)).has(leaseId)
        yield* FiberMap.remove(fibers, leaseId)
        yield* forget(leaseId)
        return held
      })

      const closeRuntime = Effect.fn('multi-host view leases close runtime')(function* (runtimeId: string) {
        const owned = [...(yield* Ref.get(leases)).entries()].filter(([, lease]) => lease.runtimeId === runtimeId).map(([leaseId]) => leaseId)
        yield* Effect.forEach(owned, close, { discard: true })
      })

      const open = Effect.fn('multi-host view lease open')(function* (runtimeId: string) {
        const runtime = yield* directory.findRuntime(runtimeId)
        if (runtime === undefined) return yield* new RuntimeNotFound({ runtimeId })
        if (runtime.originPort === undefined) return yield* new RuntimeOriginUnavailable({ runtimeId })
        const existing = [...(yield* Ref.get(leases)).entries()].find(([, lease]) => lease.runtimeId === runtime.id)
        if (existing !== undefined && (yield* pool.generation(runtime.id)) === existing[1].generation) {
          return { leaseId: existing[0], launchUrl: existing[1].launchUrl }
        }
        if (existing !== undefined) yield* close(existing[0])
        for (const oldest of (yield* Ref.get(leases)).keys()) {
          if ((yield* Ref.get(leases)).size < maxLeases) break
          yield* close(oldest)
        }
        const leaseId = randomUUID()
        const ready = yield* Deferred.make<RuntimeLease, PoolError>()
        yield* FiberMap.run(
          fibers,
          leaseId,
          Effect.scoped(
            pool.acquire(runtime.id).pipe(
              Effect.tap(lease => Deferred.succeed(ready, lease)),
              Effect.tapError(error => Deferred.fail(ready, error)),
              Effect.andThen(Effect.sleep(leaseTimeToLive)),
            ),
          ).pipe(Effect.ensuring(forget(leaseId))),
        )
        const lease = yield* Deferred.await(ready)
        yield* Ref.update(leases, current =>
          new Map(current).set(leaseId, { runtimeId: runtime.id, generation: lease.generation, launchUrl: lease.gateway.launchUrl }),
        )
        return { leaseId, launchUrl: lease.gateway.launchUrl }
      })

      return ViewLeases.of({ open, close, closeRuntime })
    }),
  )
}
