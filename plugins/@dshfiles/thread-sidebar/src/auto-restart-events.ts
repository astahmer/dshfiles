import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Effect, Layer, Stream } from 'effect'
import { AutoRestart, type AutoRestartStatus } from './auto-restart.js'
import { threadSidebarRestartApi } from './restart-api.js'

const publishStatus = Effect.fn('auto restart status publish')(function* (status: AutoRestartStatus) {
  yield* Api.publish({ contract: threadSidebarRestartApi, event: 'autoRestartChanged', payload: { phase: status.phase } }).pipe(
    Effect.catch(error => Effect.logWarning('thread-sidebar: the autoRestartChanged event was not published', error)),
  )
})

/** Tells every open status strip that the automatic restart moved, so it re-reads now instead of polling. */
export const autoRestartEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const autoRestart = yield* AutoRestart
    yield* DshxPlugin.worker(Stream.runForEach(autoRestart.statusChanges, publishStatus))
  }),
)
