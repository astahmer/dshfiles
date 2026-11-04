import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Cache, Context, Duration, Effect, Exit, Layer, Scope } from 'effect'
import { ReviewProgressUnavailable } from './errors.js'
import type { ReviewProgressToggle } from './review-progress-api.js'
import { ReviewProgressStoreModel, reviewProgressDomain } from './review-progress-store.js'

const make = Effect.gen(function* () {
  const storage = yield* StorageDomain
  const scope = yield* Effect.scope

  // The domain opens on first use and stays open for the plugin's Scope; a failed open is retried by the next call.
  const opened = yield* Cache.makeWith(
    () =>
      storage.open(reviewProgressDomain).pipe(
        Effect.flatMap(domain => ReviewProgressStoreModel.make(domain.table('marks'))),
        Scope.provide(scope),
        Effect.mapError(cause => new ReviewProgressUnavailable({ cause })),
      ),
    { capacity: 1, timeToLive: exit => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero) },
  )
  const store = Cache.get(opened, 'marks')

  const snapshot = Effect.fn('jujutsu review progress state')(function* () {
    return yield* (yield* store).snapshot
  })

  const toggle = Effect.fn('jujutsu review progress toggle')(function* (input: ReviewProgressToggle) {
    return yield* (yield* store).toggle(input).pipe(Effect.catchTag('StorageDomainWriteFailed', cause => Effect.fail(new ReviewProgressUnavailable({ cause }))))
  })

  yield* store.pipe(Effect.ignore({ log: 'Warn', message: 'Jujutsu review progress storage did not open; the next request retries' }))

  return { snapshot, toggle }
})

/** The durable review marks of this Host, shared by every browser; the storage domain closes with the plugin's Scope. */
export class ReviewProgress extends Context.Service<ReviewProgress>()('@dshfiles/jujutsu/ReviewProgress', { make }) {
  static readonly layer = Layer.effect(ReviewProgress, ReviewProgress.make)
}
