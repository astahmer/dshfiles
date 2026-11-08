import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Duration, Effect, Layer, Option, Schedule, Schema, Stream } from 'effect'
import { backgroundJobsApi } from './api.js'
import { HistoryConfig, HistoryIndex } from './history.js'
import { historyDemanded, touchHistoryDemand } from './history-demand.js'
import { JobRegistry, LiveJobs } from './live.js'
import { OutlivedJobs, TurnActivity } from './outlived.js'
import { JobsBoard } from './service.js'
import { backgroundJobsSettings } from './settings.js'
import { Settings } from '@dshfiles/dshx/effect/settings'

const INDEX_INTERVAL = Duration.seconds(30)
const CATCH_UP_DELAY = Duration.seconds(1)
const CHANGE_EVENT_INTERVAL = Duration.seconds(1)
const REAP_INTERVAL = Duration.minutes(1)
const OBSERVE_INTERVAL = Duration.seconds(5)

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
    const pass = Effect.gen(function* () {
      if (!historyDemanded()) return false
      return yield* history.pass.pipe(
        Effect.map(indexing => indexing.caughtUp),
        Effect.catchCause(cause => Effect.as(Effect.logError('background-jobs: history indexing failed', cause), false)),
      )
    })
    yield* pass.pipe(
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
      Stream.runForEach(() => {
        touchHistoryDemand()
        return Api.publish({ contract: backgroundJobsApi, event: 'changed', payload: {} }).pipe(
          Effect.catchTag('PublishEventError', error => Effect.logWarning('background-jobs: board change event refused', error.message)),
        )
      }),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)

/** Every few seconds, note which jobs outlived their turn; once a minute, stop those nobody read for the configured cap. */
const ReapLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const outlived = yield* OutlivedJobs
    // A turn ends with no job event: reading the agent registry is in-memory, so a short tick keeps the badge current.
    yield* outlived.current.pipe(Effect.repeat(Schedule.spaced(OBSERVE_INTERVAL)), DshxPlugin.detached, Effect.forkScoped)
    yield* outlived.reap.pipe(
      Effect.catchCause(cause => Effect.logError('background-jobs: stopping outlived jobs failed', cause)),
      Effect.repeat(Schedule.spaced(REAP_INTERVAL)),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)

const BackgroundJobsLive = Layer.mergeAll(IndexingLoop, ChangeEvents, ReapLoop).pipe(
  Layer.provideMerge(JobsBoard.layer),
  Layer.provideMerge(OutlivedJobs.layer),
  Layer.provideMerge(TurnActivity.layer),
  Layer.provideMerge(Settings.layer(backgroundJobsSettings)),
  Layer.provideMerge(LiveJobs.layer),
  Layer.provideMerge(HistoryIndex.layer),
  Layer.provide([HistoryConfigLive, JobRegistry.layer, NodeFileSystem.layer, NodePath.layer]),
)

export default DshxPlugin.make({
  name: '@dshfiles/background-jobs',
  settings: [backgroundJobsSettings],
  layer: BackgroundJobsLive,
  apis: [
    Api.bind(backgroundJobsApi, {
      board: input => {
        touchHistoryDemand()
        return JobsBoard.use(board => board.board(input))
      },
      output: input => {
        touchHistoryDemand()
        return JobsBoard.use(board => board.output({ jobId: input.jobId, from: input.from ?? 0 }))
      },
      kill: input => JobsBoard.use(board => board.kill({ jobId: input.jobId })),
      wait: input => JobsBoard.use(board => board.wait(input)),
      refresh: () => {
        touchHistoryDemand()
        return JobsBoard.use(board => board.refresh)
      },
    }),
  ],
})
