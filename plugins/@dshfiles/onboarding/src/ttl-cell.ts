import { Clock, Duration, Effect, Ref, Semaphore } from 'effect'

/**
 * The last value of one keyed read, kept until its time to live runs out; one read at a time. Not an Effect `Cache`:
 * a Cache lookup runs under the services captured when the layer was built, so a span it opens never reaches the
 * request's tracer (the Host test of each reader asserts its span).
 */
const make = <Key, A>(input: { readonly read: (key: Key) => Effect.Effect<A>; readonly timeToLive: (value: A) => Duration.Input }) =>
  Effect.gen(function* () {
    const last = yield* Ref.make<{ readonly key: Key; readonly value: A; readonly until: number } | null>(null)
    const oneRead = yield* Semaphore.make(1)
    return (key: Key): Effect.Effect<A> =>
      oneRead.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const cached = yield* Ref.get(last)
          if (cached !== null && cached.key === key && now < cached.until) return cached.value
          const value = yield* input.read(key)
          yield* Ref.set(last, { key, value, until: now + Duration.toMillis(Duration.fromInputUnsafe(input.timeToLive(value))) })
          return value
        }),
      )
  })

export class TtlCell {
  static readonly make = make
}
