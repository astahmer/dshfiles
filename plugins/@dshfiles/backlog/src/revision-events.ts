import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Effect, Layer, Stream } from 'effect'
import { AiActivity } from './ai-activity.js'
import { backlogApi } from './api.js'
import { BacklogStore } from './store.js'

/** A burst of writes (a backfill, a peer pull) announces its last revision once. */
const BURST_MS = 100

const publishRevision = Effect.fn('backlog revision publish')(function* (revision: number) {
  yield* Api.publish({ contract: backlogApi, event: 'changed', payload: { revision } }).pipe(
    Effect.catch(error => Effect.logWarning('backlog: the changed event was not published', error)),
  )
})

const publishAiActivity = Effect.fn('backlog ai activity publish')(function* (active: boolean) {
  yield* Api.publish({ contract: backlogApi, event: 'aiActivityChanged', payload: { active } }).pipe(
    Effect.catch(error => Effect.logWarning('backlog: the aiActivityChanged event was not published', error)),
  )
})

/**
 * Tells every open panel that the backlog revision moved or AI work started or stopped, so it re-reads now instead of
 * polling.
 */
export const RevisionEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* BacklogStore
    const activity = yield* AiActivity
    yield* DshxPlugin.worker(Stream.runForEach(Stream.debounce(store.revisions, `${BURST_MS} millis`), publishRevision))
    yield* DshxPlugin.worker(Stream.runForEach(activity.activeChanges, publishAiActivity))
  }),
)
