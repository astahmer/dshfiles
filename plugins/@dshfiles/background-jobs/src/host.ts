import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-jobs'
import { defineHost } from '@dshfiles/dshx/host'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { Cause, Context as EffectContext, Duration, Effect, Layer, Queue, Schedule, Schema, Scope } from 'effect'
import { backgroundJobsApi } from './api.js'
import { HistoryIndex } from './history.js'
import { killJob } from './kill-job.js'
import { JobsBoard } from './service.js'

const INDEX_INTERVAL_MS = 30_000
const CATCH_UP_DELAY_MS = 1_000
const DEFAULT_FILES_PER_PASS = 120
const DEFAULT_BUDGET_MS = 8_000
const CHANGE_EVENT_INTERVAL_MS = 1_000

const persistenceConfigSchema = Schema.Struct({ config: Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }) })

interface JobsRuntime {
  readonly board: JobsBoard
  readonly history: HistoryIndex
  readonly changes: Queue.Queue<void>
}

class BackgroundJobs extends EffectContext.Service<BackgroundJobs, JobsRuntime>()('dshfiles/background-jobs/BackgroundJobs') {}

const makeLayer = (context: Context): Layer.Layer<BackgroundJobs, never, never> =>
  Layer.effect(
    BackgroundJobs,
    Effect.gen(function* () {
      const changes = yield* Queue.dropping<void>(1)
      const persistence = context.get('sessionPersistence')
      const parsed = Schema.is(persistenceConfigSchema)(persistence) ? persistence : null
      const history = new HistoryIndex({
        root: parsed?.config.root ?? dshHomePath('sessions'),
        statePath: dshHomePath('runtime', 'dshfiles', 'background-jobs', 'state.json'),
        filesPerPass: DEFAULT_FILES_PER_PASS,
        budgetMs: DEFAULT_BUDGET_MS,
      })
      const board = new JobsBoard({
        history,
        onChange: () => Queue.offerUnsafe(changes, undefined),
      })
      return { board, history, changes }
    }),
  )

const reportFailure = (context: Context, step: string, error: unknown): void => {
  context.logger.warn('background-jobs: %s failed: %s', step, error instanceof Error ? error.message : String(error))
}

const runPass = (active: JobsRuntime) =>
  Effect.tryPromise({
    try: () => active.history.pass().then(() => active.board.invalidate()),
    catch: error => error,
  })

const indexingSchedule = (active: JobsRuntime) =>
  Schedule.spaced(CATCH_UP_DELAY_MS).pipe(
    Schedule.modifyDelay(() => Effect.sync(() => Duration.millis(active.history.indexing.caughtUp ? INDEX_INTERVAL_MS : CATCH_UP_DELAY_MS))),
  )

const indexingLoop = (active: JobsRuntime, context: Context) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({ try: () => active.history.load(), catch: error => error })
    yield* runPass(active).pipe(
      Effect.catchCause(cause => Effect.sync(() => reportFailure(context, 'history indexing step', Cause.squash(cause)))),
      Effect.repeat(indexingSchedule(active)),
    )
  })

const changeEvents = (active: JobsRuntime, context: Context) =>
  Effect.forever(
    Effect.gen(function* () {
      yield* Queue.take(active.changes)
      yield* Effect.sleep(Duration.millis(CHANGE_EVENT_INTERVAL_MS))
      yield* DshxEffect.publish(context, backgroundJobsApi, 'changed', {}).pipe(
        Effect.catchCause(cause => Effect.sync(() => reportFailure(context, 'board change event', Cause.squash(cause)))),
      )
    }),
  )

const { hostApi, ...plugin } = DshxEffect.plugin({
  layer: makeLayer,
  setup: (context: Context): Effect.Effect<void, never, BackgroundJobs | Scope.Scope> =>
    Effect.gen(function* () {
      const active = yield* BackgroundJobs
      yield* Effect.sync(() => {
        context.inject(['jobs'], scoped => {
          const registry = scoped.get('jobs')
          if (registry === undefined) return
          scoped.effect(() => {
            active.board.attachLive(registry)
            return () => active.board.detachLive()
          }, 'background-jobs: live job tracking')
        })
      })
      yield* indexingLoop(active, context).pipe(
        Effect.catchCause(cause => Effect.sync(() => reportFailure(context, 'history indexing startup', Cause.squash(cause)))),
        Effect.forkScoped,
      )
      yield* changeEvents(active, context).pipe(Effect.forkScoped)
    }),
})

export default defineHost({
  ...plugin,
  name: '@dshfiles/background-jobs',
  apis: [
    hostApi(backgroundJobsApi, {
      board: Effect.fn('background-jobs board')(({ input }) =>
        Effect.gen(function* () {
          const active = yield* BackgroundJobs
          return active.board.board(input)
        }),
      ),
      output: Effect.fn('background-jobs output')(({ input }) =>
        Effect.gen(function* () {
          const active = yield* BackgroundJobs
          return active.board.output({ jobId: input.jobId, from: input.from ?? 0 })
        }),
      ),
      kill: ({ input }) =>
        Effect.gen(function* () {
          const active = yield* BackgroundJobs
          return yield* killJob({ board: active.board, jobId: input.jobId })
        }),
      wait: Effect.fn('background-jobs wait')(({ input }) =>
        Effect.gen(function* () {
          const active = yield* BackgroundJobs
          return yield* active.board.wait(input)
        }),
      ),
      refresh: Effect.fn('background-jobs refresh')(({ input: _input }) =>
        Effect.gen(function* () {
          const active = yield* BackgroundJobs
          yield* runPass(active)
          return active.board.indexing()
        }),
      ),
    }),
  ],
})
