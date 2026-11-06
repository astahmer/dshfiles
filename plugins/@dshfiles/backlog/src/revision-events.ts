import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Effect, Layer, Stream } from 'effect'
import { backlogApi } from './api.js'
import { BacklogStore } from './store.js'

/** A burst of writes (a backfill, a peer pull) announces its last revision once. */
const BURST_MS = 100

const publishRevision = Effect.fn('backlog revision publish')(function* (revision: number) {
  yield* Api.publish({ contract: backlogApi, event: 'changed', payload: { revision } }).pipe(
    Effect.catch(error => Effect.logWarning('backlog: the changed event was not published', error)),
  )
})

/** Tells every open panel that the backlog revision moved, so it re-reads now instead of on its next poll. */
export const RevisionEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* BacklogStore
    yield* DshxPlugin.worker(Stream.runForEach(Stream.debounce(store.revisions, `${BURST_MS} millis`), publishRevision))
  }),
)
