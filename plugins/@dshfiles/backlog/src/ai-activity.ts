import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'

/** Whether any model or Jev work for the backlog is in flight, so the panel can show that it is thinking. */
export class AiActivity extends Context.Service<
  AiActivity,
  {
    readonly isActive: Effect.Effect<boolean>
    /** Each flip between idle and busy, after the current state; concurrent work inside one busy stretch emits nothing. */
    readonly activeChanges: Stream.Stream<boolean>
    readonly track: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
>()('@dshfiles/backlog/AiActivity') {
  static readonly layer = Layer.effect(
    AiActivity,
    Effect.gen(function* () {
      const running = yield* SubscriptionRef.make(0)
      return AiActivity.of({
        isActive: Effect.map(SubscriptionRef.get(running), count => count > 0),
        activeChanges: SubscriptionRef.changes(running).pipe(
          Stream.map(count => count > 0),
          Stream.changes,
          Stream.drop(1),
        ),
        track: work =>
          Effect.acquireUseRelease(
            SubscriptionRef.update(running, count => count + 1),
            () => work,
            () => SubscriptionRef.update(running, count => count - 1),
          ),
      })
    }),
  )
}
