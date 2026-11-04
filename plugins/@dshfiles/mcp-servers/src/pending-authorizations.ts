import { Clock, Context, Duration, Effect, Layer, Option, Ref } from 'effect'
import type { PendingAuthorization } from './oauth.js'

const PENDING_TTL = Duration.minutes(10)

/** OAuth sign-ins waiting for their provider callback, keyed by `state`; one older than 10 minutes is dropped on the next take. */
export class PendingAuthorizations extends Context.Service<
  PendingAuthorizations,
  {
    readonly put: (pending: Omit<PendingAuthorization, 'createdAt'>) => Effect.Effect<void>
    /** Remove and return the authorization for `state`, if it is still live; a state is usable once. */
    readonly take: (state: string) => Effect.Effect<Option.Option<PendingAuthorization>>
  }
>()('@dshfiles/mcp-servers/PendingAuthorizations') {
  static readonly layer = Layer.effect(
    PendingAuthorizations,
    Effect.gen(function* () {
      const pending = yield* Ref.make<ReadonlyMap<string, PendingAuthorization>>(new Map())
      const ttl = Duration.toMillis(PENDING_TTL)

      const put = Effect.fn('mcp oauth pending put')(function* (input: Omit<PendingAuthorization, 'createdAt'>) {
        const createdAt = yield* Clock.currentTimeMillis
        yield* Ref.update(pending, current => new Map(current).set(input.state, { ...input, createdAt }))
      })

      const take = Effect.fn('mcp oauth pending take')(function* (state: string) {
        const now = yield* Clock.currentTimeMillis
        return yield* Ref.modify(pending, current => {
          const live = new Map([...current].filter(([, entry]) => now - entry.createdAt <= ttl))
          const found = Option.fromUndefinedOr(live.get(state))
          live.delete(state)
          return [found, live]
        })
      })

      return PendingAuthorizations.of({ put, take })
    }),
  )
}
