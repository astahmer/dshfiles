import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Duration, Effect, Layer, Option, Schedule, Schema, Stream } from 'effect'
import { backgroundJobsApi } from './api.js'
import { HistoryConfig, HistoryIndex } from './history.js'
import { JobRegistry, LiveJobs } from './live.js'
import { JobsBoard } from './service.js'

const INDEX_INTERVAL = Duration.seconds(30)
const CATCH_UP_DELAY = Duration.seconds(1)
const CHANGE_EVENT_INTERVAL = Duration.seconds(1)

const decodePersistence = Schema.decodeUnknownOption(Schema.Struct({ config: Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }) }))

const HistoryConfigLive = Layer.unwrap(
  Effect.gen(function* () {
    const persistence = yield* Effect.option(hostService('sessionPersistence'))
    const root = Option.getOrElse(
      Option.map(Option.flatMap(persistence, decodePersistence), persisted => persisted.config.root),
      () => dshHomePath('sessions'),
    )
    return HistoryConfig.layer({
      root,
      statePath: dshHomePath('runtime', 'dshfiles', 'background-jobs', 'state.json'),
      filesPerPass: 120,
      budgetMs: 8_000,
    })
  }),
)

/** Index right away, then every second while catching up and every 30 seconds once caught up. */
const IndexingLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const history = yield* HistoryIndex
    yield* history.pass.pipe(
      Effect.map(indexing => indexing.caughtUp),
      Effect.catchCause(cause => Effect.as(Effect.logError('background-jobs: history indexing failed', cause), false)),
      Effect.repeat(
        Schedule.spaced(CATCH_UP_DELAY).pipe(
          Schedule.setInputType<boolean>(),
          Schedule.modifyDelay(step => Effect.succeed(step.input ? INDEX_INTERVAL : CATCH_UP_DELAY)),
        ),
      ),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)

/** Tell browsers to read the board again: at most once a second, a second after the first change. */
const ChangeEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const board = yield* JobsBoard
    yield* board.changes.pipe(
      Stream.groupedWithin(Number.MAX_SAFE_INTEGER, CHANGE_EVENT_INTERVAL),
      Stream.runForEach(() =>
        Api.publish({ contract: backgroundJobsApi, event: 'changed', payload: {} }).pipe(
          Effect.catchTag('PublishEventError', error => Effect.logWarning('background-jobs: board change event refused', error.message)),
        ),
      ),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)

const BackgroundJobsLive = Layer.mergeAll(IndexingLoop, ChangeEvents).pipe(
  Layer.provideMerge(JobsBoard.layer),
  Layer.provideMerge(LiveJobs.layer),
  Layer.provideMerge(HistoryIndex.layer),
  Layer.provide([HistoryConfigLive, JobRegistry.layer, NodeFileSystem.layer, NodePath.layer]),
)

export default DshxPlugin.make({
  name: '@dshfiles/background-jobs',
  layer: BackgroundJobsLive,
  apis: [
    Api.bind(backgroundJobsApi, {
      board: input => JobsBoard.use(board => board.board(input)),
      output: input => JobsBoard.use(board => board.output({ jobId: input.jobId, from: input.from ?? 0 })),
      kill: input => JobsBoard.use(board => board.kill({ jobId: input.jobId })),
      wait: input => JobsBoard.use(board => board.wait(input)),
      refresh: () => JobsBoard.use(board => board.refresh),
    }),
  ],
})
