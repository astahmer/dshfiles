import { Cache, Context, Duration, Effect, Exit, Layer, Option, Ref, Schema } from 'effect'
import type { AccountsUsage } from './api.js'

/** One sweep of every account's quota did not answer in time; it was abandoned and nothing was cached. */
export class UsageReadTimedOut extends Schema.TaggedError<UsageReadTimedOut>()('UsageReadTimedOut', {
  timeoutMs: Schema.Number,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Account usage read timed out after ${String(this.timeoutMs)} ms.`
  }
}

/** One sweep of every account's quota failed; the previous sweep stays the latest. */
export class UsageReadFailed extends Schema.TaggedError<UsageReadFailed>()('UsageReadFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : 'Account usage could not be read.'
  }
}

export type UsageSweepError = UsageReadTimedOut | UsageReadFailed

const SWEEP = 'all'

/**
 * One sweep shared by every surface that asks within the time to live: the page, the sidebar footer and the edge
 * overlay each poll, and without this each would make its own authenticated request per account per minute. A failed
 * sweep is never cached. An invalidation drops the cached sweep and any sweep still in flight: that read answers its
 * own callers but never becomes the latest, and the next caller starts a fresh one instead of joining it.
 */
export class UsageSnapshot extends Context.Service<
  UsageSnapshot,
  {
    readonly get: Effect.Effect<AccountsUsage, UsageSweepError>
    readonly refresh: Effect.Effect<AccountsUsage, UsageSweepError>
    /** The last sweep however old, without starting one; `undefined` after an invalidation. */
    readonly latest: () => AccountsUsage | undefined
    readonly invalidate: Effect.Effect<void>
  }
>()('@dshfiles/ai-accounts/UsageSnapshot') {
  static readonly make = Effect.fnUntraced(function* (input: {
    readonly read: Effect.Effect<AccountsUsage, UsageReadFailed>
    readonly timeToLive: Duration.Input
    readonly timeout: Duration.Input
  }) {
    const timeoutMs = Duration.toMillis(Duration.fromInputUnsafe(input.timeout))
    const generation = yield* Ref.make(0)
    const latest = yield* Ref.make(Option.none<AccountsUsage>())
    const sweep = Effect.gen(function* () {
      const started = yield* Ref.get(generation)
      const usage = yield* input.read.pipe(Effect.timeoutOrElse({ duration: input.timeout, orElse: () => Effect.fail(new UsageReadTimedOut({ timeoutMs })) }))
      if ((yield* Ref.get(generation)) === started) yield* Ref.set(latest, Option.some(usage))
      return usage
    }).pipe(Effect.withSpan('ai-accounts usage sweep'))
    const cache = yield* Cache.makeWith((_: typeof SWEEP) => sweep, {
      capacity: 1,
      timeToLive: exit => (Exit.isSuccess(exit) ? input.timeToLive : Duration.zero),
    })
    return UsageSnapshot.of({
      get: Cache.get(cache, SWEEP),
      refresh: Cache.refresh(cache, SWEEP),
      latest: () => Option.getOrUndefined(Ref.getUnsafe(latest)),
      invalidate: Effect.andThen(
        Ref.update(generation, current => current + 1),
        Effect.andThen(Ref.set(latest, Option.none()), Cache.invalidateAll(cache)),
      ),
    })
  })

  static readonly layer = (input: Parameters<typeof UsageSnapshot.make>[0]) => Layer.effect(UsageSnapshot, UsageSnapshot.make(input))
}
