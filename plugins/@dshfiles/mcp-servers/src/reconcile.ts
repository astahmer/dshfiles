import { Effect, Exit, Ref, Scope, Semaphore } from 'effect'

export interface ClientTarget {
  readonly id: string
  readonly enabled: boolean
  readonly ready: boolean
  readonly suspended?: boolean
  readonly fingerprint: string
}

export interface ReconcilePlan<Target extends ClientTarget> {
  readonly targets: ReadonlyArray<Target>
  readonly restart: ReadonlySet<string>
}

export type ClientLifecycle = 'inactive' | 'starting' | 'loaded' | 'start-failed' | 'manually-disconnected'

interface ActiveClient {
  readonly fingerprint: string
  readonly scope: Scope.Closeable
}

/** Serializes native client start/stop transitions; each running client owns a child Scope of the reconciler's. */
export interface ClientReconciler<Target extends ClientTarget> {
  readonly update: (targets: ReadonlyArray<Target>) => Effect.Effect<void>
  /** Compute the plan and apply it under one permit, so an older plan can never be applied after a newer one. */
  readonly reconcile: <E, R>(plan: Effect.Effect<ReconcilePlan<Target>, E, R>) => Effect.Effect<void, E, R>
  /** Stop and recreate one client. */
  readonly restart: (id: string, targets: ReadonlyArray<Target>) => Effect.Effect<void>
  readonly state: (id: string) => Effect.Effect<ClientLifecycle>
  readonly dispose: Effect.Effect<void>
}

const withEntry = <V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> => new Map(map).set(key, value)

const withoutEntry = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  const next = new Map(map)
  next.delete(key)
  return next
}

/**
 * Create a reconciler whose `start` runs in a fresh child Scope per client; closing that Scope stops the client, and
 * closing the surrounding Scope stops every client still running.
 */
export const makeClientReconciler = <Target extends ClientTarget>(
  start: (target: Target) => Effect.Effect<void, unknown, Scope.Scope>,
): Effect.Effect<ClientReconciler<Target>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const root = yield* Scope.Scope
    const lock = yield* Semaphore.make(1)
    const active = yield* Ref.make<ReadonlyMap<string, ActiveClient>>(new Map())
    const lifecycle = yield* Ref.make<ReadonlyMap<string, ClientLifecycle>>(new Map())

    const stop = Effect.fnUntraced(function* (id: string) {
      const current = (yield* Ref.get(active)).get(id)
      if (current === undefined) return
      yield* Ref.update(active, map => withoutEntry(map, id))
      yield* Scope.close(current.scope, Exit.void)
    })

    const launch = Effect.fnUntraced(function* (target: Target) {
      yield* Ref.update(lifecycle, map => withEntry(map, target.id, 'starting'))
      const scope = yield* Scope.fork(root)
      const started = yield* Effect.exit(start(target).pipe(Scope.provide(scope)))
      if (Exit.isFailure(started)) {
        yield* Scope.close(scope, started)
        yield* Ref.update(lifecycle, map => withEntry(map, target.id, 'start-failed'))
        return
      }
      yield* Ref.update(active, map => withEntry(map, target.id, { fingerprint: target.fingerprint, scope }))
      yield* Ref.update(lifecycle, map => withEntry(map, target.id, 'loaded'))
    })

    const apply = Effect.fnUntraced(function* (targets: ReadonlyArray<Target>) {
      const byId = new Map(targets.map(target => [target.id, target]))
      const desired = new Map(targets.filter(target => target.enabled && target.ready && target.suspended !== true).map(target => [target.id, target]))
      for (const [id, current] of yield* Ref.get(active)) {
        const next = desired.get(id)
        if (next === undefined || next.fingerprint !== current.fingerprint) yield* stop(id)
      }
      const running = yield* Ref.get(active)
      yield* Ref.update(lifecycle, previous => {
        const next = new Map<string, ClientLifecycle>()
        for (const [id, target] of byId) {
          if (target.suspended === true) next.set(id, 'manually-disconnected')
          else if (!target.enabled || !target.ready) next.set(id, 'inactive')
          else if (running.has(id)) next.set(id, 'loaded')
          else next.set(id, previous.get(id) === 'start-failed' ? 'start-failed' : 'starting')
        }
        return next
      })
      for (const [id, target] of desired) if (!running.has(id)) yield* launch(target)
    })

    const restartNow = Effect.fnUntraced(function* (id: string, targets: ReadonlyArray<Target>) {
      yield* stop(id)
      yield* Ref.update(lifecycle, map => withoutEntry(map, id))
      yield* apply(targets)
    })

    const update = (targets: ReadonlyArray<Target>) => lock.withPermit(apply(targets))

    const reconciler: ClientReconciler<Target> = {
      update,
      reconcile: plan =>
        lock.withPermit(
          Effect.gen(function* () {
            const next = yield* plan
            // Every restarted client stops before anything starts, then one apply starts them all.
            for (const id of next.restart) {
              yield* stop(id)
              yield* Ref.update(lifecycle, map => withoutEntry(map, id))
            }
            yield* apply(next.targets)
          }),
        ),
      restart: (id, targets) => lock.withPermit(restartNow(id, targets)),
      state: id => Effect.map(Ref.get(lifecycle), map => map.get(id) ?? 'inactive'),
      dispose: update([]),
    }
    return reconciler
  })
