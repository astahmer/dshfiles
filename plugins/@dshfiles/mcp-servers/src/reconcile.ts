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

/** Each start awaits a transport handshake and spawns a child process; a profile boot overlaps a few, not all of them. */
const START_CONCURRENCY = 4

/** One entry per target: a loaded client is the only state that owns a running child Scope. */
type ClientEntry =
  | { readonly state: 'inactive' }
  | { readonly state: 'manually-disconnected' }
  | { readonly state: 'start-failed' }
  | { readonly state: 'starting'; readonly fingerprint: string }
  | { readonly state: 'loaded'; readonly fingerprint: string; readonly scope: Scope.Closeable }

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

const loadedEntries = (map: ReadonlyMap<string, ClientEntry>): ReadonlyArray<readonly [string, Extract<ClientEntry, { readonly state: 'loaded' }>]> =>
  [...map].flatMap(([id, entry]) => (entry.state === 'loaded' ? [[id, entry] as const] : []))

const closeScope = (scope: Scope.Closeable) => Scope.close(scope, Exit.void)

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
    const clients = yield* Ref.make<ReadonlyMap<string, ClientEntry>>(new Map())

    /** Drops the entry and closes the client's Scope: a stopped client is never left with a running Scope. */
    const stop = Effect.fnUntraced(function* (id: string) {
      const entry = yield* Ref.modify(clients, current => [current.get(id), withoutEntry(current, id)] as const)
      if (entry?.state === 'loaded') yield* closeScope(entry.scope)
    })

    const launch = Effect.fnUntraced(function* (target: Target) {
      yield* Ref.update(clients, map => withEntry(map, target.id, { state: 'starting', fingerprint: target.fingerprint }))
      const scope = yield* Scope.fork(root)
      const started = yield* Effect.exit(start(target).pipe(Scope.provide(scope)))
      if (Exit.isFailure(started)) {
        yield* closeScope(scope)
        yield* Ref.update(clients, map => withEntry(map, target.id, { state: 'start-failed' }))
        return
      }
      yield* Ref.update(clients, map => withEntry(map, target.id, { state: 'loaded', fingerprint: target.fingerprint, scope }))
    })

    const apply = Effect.fnUntraced(function* (targets: ReadonlyArray<Target>) {
      const byId = new Map(targets.map(target => [target.id, target]))
      const desired = new Map(targets.filter(target => target.enabled && target.ready && target.suspended !== true).map(target => [target.id, target]))
      for (const [id, entry] of loadedEntries(yield* Ref.get(clients))) {
        const next = desired.get(id)
        if (next === undefined || next.fingerprint !== entry.fingerprint) yield* stop(id)
      }
      const current = yield* Ref.get(clients)
      const running = new Set(loadedEntries(current).map(([id]) => id))
      const next = new Map<string, ClientEntry>()
      for (const [id, target] of byId) {
        if (target.suspended === true) next.set(id, { state: 'manually-disconnected' })
        else if (!target.enabled || !target.ready) next.set(id, { state: 'inactive' })
        else if (running.has(id)) {
          const entry = current.get(id)
          if (entry?.state === 'loaded') next.set(id, entry)
        } else next.set(id, current.get(id)?.state === 'start-failed' ? { state: 'start-failed' } : { state: 'starting', fingerprint: target.fingerprint })
      }
      yield* Ref.set(clients, next)
      const starting = [...desired.values()].filter(target => !running.has(target.id))
      yield* Effect.forEach(starting, launch, { concurrency: START_CONCURRENCY })
    })

    const restartNow = Effect.fnUntraced(function* (id: string, targets: ReadonlyArray<Target>) {
      yield* stop(id)
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
            for (const id of next.restart) yield* stop(id)
            yield* apply(next.targets)
          }),
        ),
      restart: (id, targets) => lock.withPermit(restartNow(id, targets)),
      state: id => Effect.map(Ref.get(clients), map => map.get(id)?.state ?? 'inactive'),
      dispose: update([]),
    }
    return reconciler
  })
