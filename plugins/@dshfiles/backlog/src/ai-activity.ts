import { Context, Effect, Layer, Ref } from 'effect'

/** Whether any model or Jev work for the backlog is in flight, so the panel can show that it is thinking. */
export class AiActivity extends Context.Service<
  AiActivity,
  {
    readonly isActive: Effect.Effect<boolean>
    readonly track: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
>()('@dshfiles/backlog/AiActivity') {
  static readonly layer = Layer.effect(
    AiActivity,
    Effect.gen(function* () {
      const running = yield* Ref.make(0)
      return AiActivity.of({
        isActive: Effect.map(Ref.get(running), count => count > 0),
        track: work =>
          Effect.acquireUseRelease(
            Ref.update(running, count => count + 1),
            () => work,
            () => Ref.update(running, count => count - 1),
          ),
      })
    }),
  )
}
