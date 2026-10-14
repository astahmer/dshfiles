import type { Context, Effect } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-llm'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { usageApi } from './api.js'
import { indexSessionLogs } from './indexer.js'
import { observeLiveCall } from './live-calls.js'
import { createRatePricer } from './pricing.js'
import { openUsageStore, type UsageStore } from './store.js'

const INDEX_INTERVAL_MS = 30_000

const persistenceConfigSchema = z.object({ config: z.object({ root: z.string().min(1) }) })

/** The JSONL backend's configured root, else the default `$DSH_HOME/sessions`. */
const sessionsRoot = (context: Context): string => {
  const parsed = persistenceConfigSchema.safeParse(context.get('sessionPersistence'))
  return parsed.success ? parsed.data.config.root : dshHomePath('sessions')
}

interface UsageRuntime {
  readonly store: UsageStore
  readonly pricer: ReturnType<typeof createRatePricer>
  readonly root: string
  pass: Promise<void> | null
  lastIndexedAt: number | null
  lastError: string | null
}

let runtime: UsageRuntime | undefined

const requireRuntime = (): UsageRuntime => {
  if (runtime === undefined) throw new Error('Usage Host is not active.')
  return runtime
}

const runPass = (active: UsageRuntime): Promise<void> => {
  if (active.pass !== null) return active.pass
  const pass = (async () => {
    try {
      await indexSessionLogs(active.store, active.root)
      active.store.reconcileLiveCalls(Date.now())
      await active.pricer.update()
      active.lastIndexedAt = Date.now()
      active.lastError = null
    } catch (error) {
      active.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    }
  })().finally(() => {
    active.pass = null
  })
  active.pass = pass
  return pass
}

const status = (active: UsageRuntime) => {
  const counts = active.store.counts()
  return {
    indexedFiles: counts.files,
    requests: counts.requests,
    lastIndexedAt: active.lastIndexedAt,
    indexing: active.pass !== null,
    pricingFetchedAt: active.pricer.fetchedAt(),
    lastError: active.lastError,
  }
}

const api = usageApi.host({
  requests: ({ input }) => requireRuntime().store.requests(input),
  charts: ({ input }) => requireRuntime().store.charts(input),
  status: () => status(requireRuntime()),
  refresh: async () => {
    const active = requireRuntime()
    await runPass(active)
    return status(active)
  },
})

const setupHost = (context: Context): Effect<void> => {
  const store = openUsageStore(dshHomePath('plugins', 'usage', 'usage.db'))
  const active: UsageRuntime = { store, pricer: createRatePricer({ store }), root: sessionsRoot(context), pass: null, lastIndexedAt: null, lastError: null }
  runtime = active
  context.on(
    'llm/stream',
    (options, next) =>
      observeLiveCall({
        options,
        next,
        record: row => {
          if (runtime === active) active.store.insertLiveCall(row)
        },
      }),
    { global: true },
  )
  void runPass(active)
  const timer = setInterval(() => void runPass(active), INDEX_INTERVAL_MS)
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        clearInterval(timer)
        await active.pass
        if (runtime === active) runtime = undefined
        store.close()
      }
    },
  }
}

const host = defineHost({
  name: 'usage',
  apis: [api],
  setup: setupHost,
})

export default host
