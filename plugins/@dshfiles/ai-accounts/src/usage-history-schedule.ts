import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Cause, Clock, Context, Effect, Exit, Fiber, Layer, Option, Ref, type Schedule, Schema, Semaphore } from 'effect'

/** A quota history sweep failed before it stored anything it read. */
export class UsageHistoryCollectFailed extends Schema.TaggedError<UsageHistoryCollectFailed>()('UsageHistoryCollectFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : 'Quota history could not be collected.'
  }
}

/**
 * Quota history collection on a schedule: every minute the plugin checks whether the interval stored with the history
 * has passed and sweeps once when it has. A manual collection and the schedule share one sweep in flight. Closing the
 * plugin interrupts that sweep (its signal aborts) and later manual calls record nothing.
 */
export class UsageHistorySchedule extends Context.Service<
  UsageHistorySchedule,
  {
    /** Sweep now, or join the sweep already running; the number of accounts it recorded. */
    readonly collectNow: Effect.Effect<number, UsageHistoryCollectFailed>
  }
>()('@dshfiles/ai-accounts/UsageHistorySchedule') {
  static readonly make = Effect.fnUntraced(function* (input: {
    readonly sweep: Effect.Effect<number, UsageHistoryCollectFailed>
    /** When the next sweep is due in epoch milliseconds, or `undefined` while history storage is unavailable. */
    readonly nextSweepAt: Effect.Effect<number | undefined, UsageHistoryCollectFailed>
    readonly checkEvery: Schedule.Schedule<unknown>
  }) {
    const scope = yield* Effect.scope
    const running = yield* Ref.make(Option.none<Fiber.Fiber<number, UsageHistoryCollectFailed>>())
    const closed = yield* Ref.make(false)
    const claim = yield* Semaphore.make(1)
    yield* Effect.addFinalizer(() => Ref.set(closed, true))

    const sweep = input.sweep.pipe(Effect.ensuring(Ref.set(running, Option.none())), Effect.withSpan('ai-accounts usage history sweep'))

    const collectNow = Effect.gen(function* () {
      if (yield* Ref.get(closed)) return 0
      const fiber = yield* claim.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(running)
          if (Option.isSome(current)) return current.value
          const started = yield* Effect.forkIn(sweep, scope)
          yield* Ref.set(running, Option.some(started))
          return started
        }),
      )
      const exit = yield* Fiber.await(fiber)
      if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return 0
      return yield* exit
    })

    const collectIfDue = Effect.gen(function* () {
      if (Option.isSome(yield* Ref.get(running))) return
      const dueAt = yield* input.nextSweepAt
      if (dueAt === undefined || (yield* Clock.currentTimeMillis) < dueAt) return
      yield* collectNow
    }).pipe(Effect.ignore)

    yield* DshxPlugin.worker(Effect.repeat(collectIfDue, input.checkEvery))
    return UsageHistorySchedule.of({ collectNow: Effect.withSpan(collectNow, 'ai-accounts usage history collect') })
  })

  static readonly layer = (input: Parameters<typeof UsageHistorySchedule.make>[0]) => Layer.effect(UsageHistorySchedule, UsageHistorySchedule.make(input))
}
