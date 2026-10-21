import type { Context, Effect } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-jobs'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { backgroundJobsApi } from './api.js'
import { HistoryIndex } from './history.js'
import { JobsBoard } from './service.js'

const INDEX_INTERVAL_MS = 30_000
const CATCH_UP_DELAY_MS = 1_000
const DEFAULT_FILES_PER_PASS = 120
const DEFAULT_BUDGET_MS = 8_000

const persistenceConfigSchema = z.object({ config: z.object({ root: z.string().min(1) }) })

/** The JSONL backend's configured root, else the default `$DSH_HOME/sessions`. */
const sessionsRoot = (context: Context): string => {
  const parsed = persistenceConfigSchema.safeParse(context.get('sessionPersistence'))
  return parsed.success ? parsed.data.config.root : dshHomePath('sessions')
}

interface JobsRuntime {
  readonly board: JobsBoard
  readonly history: HistoryIndex
  pass: Promise<void> | null
  timer: ReturnType<typeof setTimeout> | null
  stopped: boolean
}

let runtime: JobsRuntime | undefined

const requireRuntime = (): JobsRuntime => {
  if (runtime === undefined) throw new Error('Background jobs Host is not active.')
  return runtime
}

const runPass = (active: JobsRuntime): Promise<void> => {
  if (active.pass !== null) return active.pass
  const pass = active.history
    .pass()
    .then(() => active.board.invalidate())
    .finally(() => {
      active.pass = null
    })
  active.pass = pass
  return pass
}

const api = backgroundJobsApi.host({
  board: ({ input }) => requireRuntime().board.board(input),
  output: ({ input }) => requireRuntime().board.output({ jobId: input.jobId, from: input.from ?? 0 }),
  kill: ({ input }) => requireRuntime().board.kill({ jobId: input.jobId }),
  wait: ({ input }) => requireRuntime().board.wait(input),
  refresh: async () => {
    const active = requireRuntime()
    await runPass(active)
    return active.board.indexing()
  },
})

const setupHost = (context: Context): Effect<void> => {
  const history = new HistoryIndex({
    root: sessionsRoot(context),
    statePath: dshHomePath('runtime', 'dshfiles', 'background-jobs', 'state.json'),
    filesPerPass: DEFAULT_FILES_PER_PASS,
    budgetMs: DEFAULT_BUDGET_MS,
  })
  const active: JobsRuntime = { board: new JobsBoard({ history }), history, pass: null, timer: null, stopped: false }
  runtime = active
  context.inject(['jobs'], scoped => {
    const registry = scoped.get('jobs')
    if (registry === undefined) return
    scoped.effect(() => {
      active.board.attachLive(registry)
      return () => active.board.detachLive()
    }, 'background-jobs: live job tracking')
  })
  const reportStepFailure = (error: unknown): void => {
    context.logger.warn('background-jobs: history indexing step failed: %s', error instanceof Error ? error.message : String(error))
  }
  const step = async (): Promise<void> => {
    if (active.stopped) return
    await runPass(active)
    if (active.stopped) return
    active.timer = setTimeout(() => void step().catch(reportStepFailure), active.board.indexing().caughtUp ? INDEX_INTERVAL_MS : CATCH_UP_DELAY_MS)
  }
  void history
    .load()
    .then(() => step())
    .catch(reportStepFailure)
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        active.stopped = true
        if (active.timer !== null) clearTimeout(active.timer)
        await active.pass
        if (runtime === active) runtime = undefined
      }
    },
  }
}

export default defineHost({
  name: '@dshfiles/background-jobs',
  apis: [api],
  setup: setupHost,
})
