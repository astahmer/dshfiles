import { Context, Effect, Layer, Ref } from 'effect'

/** How long a board read keeps the job-history indexer running. */
const DEMAND_WINDOW_MS = 5 * 60_000

/**
 * Reading the board is what makes the history index worth its passes. Once nobody has read it for a while the indexer
 * stops, so an idle Host does not keep folding every Session log's job records every thirty seconds.
 */
export class HistoryDemand extends Context.Service<
  HistoryDemand,
  {
    readonly touch: Effect.Effect<void>
    readonly demanded: Effect.Effect<boolean>
  }
>()('@dshfiles/background-jobs/HistoryDemand') {
  static readonly layer = Layer.effect(
    HistoryDemand,
    Effect.gen(function* () {
      const last = yield* Ref.make(Date.now())
      return HistoryDemand.of({
        touch: Ref.set(last, Date.now()),
        demanded: Effect.map(Ref.get(last), at => Date.now() - at < DEMAND_WINDOW_MS),
      })
    }),
  )
}
