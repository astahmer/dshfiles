import { Clock, Duration, Effect, FiberMap, Ref } from 'effect'

interface Entry<Status> {
  readonly status: Status
  readonly refreshedAt: number
}

export interface StatusSnapshot<Status> {
  readonly status: Status | undefined
  readonly stale: boolean
  readonly refreshing: boolean
}

/**
 * The last status per runtime, served stale while a background refresh replaces it (stale-while-revalidate). One
 * refresh per runtime runs at a time; `invalidate` drops the entry and interrupts a running refresh, so its result
 * is discarded. A failed status stays fresh longer than a successful one, to rate-limit retries at an offline host.
 */
const make = Effect.fnUntraced(function* <Status extends { readonly ok: boolean }>(input: {
  readonly successTtl: Duration.Input
  readonly failureTtl: Duration.Input
  readonly capacity: number
  readonly spanName: string
}) {
  const entries = yield* Ref.make(new Map<string, Entry<Status>>())
  const refreshes = yield* FiberMap.make<string>()
  const successTtl = Duration.toMillis(Duration.fromInputUnsafe(input.successTtl))
  const failureTtl = Duration.toMillis(Duration.fromInputUnsafe(input.failureTtl))

  const read = Effect.fnUntraced(function* (runtimeId: string) {
    const entry = (yield* Ref.get(entries)).get(runtimeId)
    const refreshing = yield* FiberMap.has(refreshes, runtimeId)
    if (entry === undefined) return { status: undefined, stale: true, refreshing } satisfies StatusSnapshot<Status>
    const now = yield* Clock.currentTimeMillis
    const ttl = entry.status.ok ? successTtl : failureTtl
    return { status: entry.status, stale: now >= entry.refreshedAt + ttl, refreshing } satisfies StatusSnapshot<Status>
  })

  const store = (runtimeId: string, status: Status) =>
    Effect.flatMap(Clock.currentTimeMillis, refreshedAt =>
      Ref.update(entries, current => {
        const next = new Map(current)
        next.delete(runtimeId)
        next.set(runtimeId, { status, refreshedAt })
        for (const oldest of next.keys()) {
          if (next.size <= input.capacity) break
          next.delete(oldest)
        }
        return next
      }),
    )

  /** Start a refresh with `load` unless one is running; returns at once. */
  const refresh = (runtimeId: string, load: Effect.Effect<Status>) =>
    FiberMap.run(
      refreshes,
      runtimeId,
      Effect.flatMap(load, status => store(runtimeId, status)).pipe(
        Effect.withSpan(input.spanName, { attributes: { 'dshx.multi-host.runtime_id': runtimeId } }),
      ),
      { onlyIfMissing: true },
    ).pipe(Effect.asVoid)

  const invalidate = (runtimeId: string) =>
    Effect.andThen(
      FiberMap.remove(refreshes, runtimeId),
      Ref.update(entries, current => {
        const next = new Map(current)
        next.delete(runtimeId)
        return next
      }),
    )

  return { read, refresh, invalidate }
})

export interface StatusSnapshots<Status> {
  readonly read: (runtimeId: string) => Effect.Effect<StatusSnapshot<Status>>
  readonly refresh: (runtimeId: string, load: Effect.Effect<Status>) => Effect.Effect<void>
  readonly invalidate: (runtimeId: string) => Effect.Effect<void>
}

export class StatusSnapshotsModel {
  static readonly make = make
}
