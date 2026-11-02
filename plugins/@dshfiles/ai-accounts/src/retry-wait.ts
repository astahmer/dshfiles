import { Context, Deferred, Duration, Effect, HashMap, Layer, Option, Ref } from 'effect'

/**
 * One retry wait per running thread. A newer wait for the same thread ends the older one (`false`), an explicit
 * selection releases it early (`true`), the turn's abort cancels it (`false`), and closing the plugin ends them all.
 */
export class RetryWait extends Context.Service<
  RetryWait,
  {
    /** Whether the retry should go out: `true` after the delay or a release, `false` when cancelled or replaced. */
    readonly wait: (sessionId: string, delayMs: number, signal: AbortSignal) => Effect.Effect<boolean>
    /** Release a thread's wait after an explicit selection; never wakes or cancels Agent work. */
    readonly release: (sessionId: string) => void
  }
>()('@dshfiles/ai-accounts/RetryWait') {
  static readonly make = Effect.gen(function* () {
    const waits = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<boolean>>())
    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Ref.getAndSet(waits, HashMap.empty()), pending =>
        Effect.forEach(HashMap.values(pending), gate => Deferred.succeed(gate, false), { discard: true }),
      ),
    )

    const aborted = (signal: AbortSignal) =>
      Effect.callback<boolean>(resume => {
        const abort = (): void => resume(Effect.succeed(false))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        return Effect.sync(() => signal.removeEventListener('abort', abort))
      })

    const wait = Effect.fn('ai-accounts retry wait')(function* (sessionId: string, delayMs: number, signal: AbortSignal) {
      if (signal.aborted) return false
      if (delayMs <= 0) return true
      const gate = yield* Deferred.make<boolean>()
      const replaced = yield* Ref.modify(waits, current => [HashMap.get(current, sessionId), HashMap.set(current, sessionId, gate)] as const)
      if (Option.isSome(replaced)) yield* Deferred.succeed(replaced.value, false)
      return yield* Effect.raceAll([Deferred.await(gate), Effect.as(Effect.sleep(Duration.millis(delayMs)), true), aborted(signal)]).pipe(
        Effect.ensuring(
          Ref.update(waits, current => (Option.getOrUndefined(HashMap.get(current, sessionId)) === gate ? HashMap.remove(current, sessionId) : current)),
        ),
      )
    })

    const release = (sessionId: string): void => {
      const gate = HashMap.get(Ref.getUnsafe(waits), sessionId)
      if (Option.isSome(gate)) Deferred.doneUnsafe(gate.value, Effect.succeed(true))
    }

    return RetryWait.of({ wait, release })
  })

  static readonly layer = Layer.effect(RetryWait, RetryWait.make)
}
