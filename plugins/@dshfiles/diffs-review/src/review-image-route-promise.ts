import type {} from '@deepseek-ai/dsh-client-connection'
import { DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { Effect, Layer } from 'effect'
import { ReviewImages, serveReviewImage } from './review-image.js'
import { REVIEW_IMAGE_PATH } from './review-image-query.js'

/**
 * `GET /api/diffs-review.image` inside Connection's authentication fence, removed when the plugin unloads. The Promise
 * edge: Connection's route handler and its disposer are Promise APIs.
 */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const connection = yield* hostService('connection')
    const run = Effect.runPromiseWith(yield* DshxPlugin.detachedContext<ReviewImages>())
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        connection.fetch.register({
          path: REVIEW_IMAGE_PATH,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: request => run(serveReviewImage(request), { signal: request.signal }),
        }),
      ),
      remove => Effect.promise(async () => remove()),
    )
  }),
)

export const ReviewImageRoute = { layer } as const
