import { readdir, stat } from 'node:fs/promises'
import type { Context, Effect } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-llm'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { dshxRegistryApi } from '@dshfiles/dshx/api'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { localOtlpEndpoint } from '@dshfiles/dshx/tracing'
import { z } from 'zod'
import { resolveActivityQuery, resolveOtelMetricsRange, usageApi } from './api.js'
import type { ToolSourceMetadata } from './fold.js'
import { createJevUsageRecorder, jevSourceOf } from './jev-usage-recorder.js'
import { createUsageIndexService } from './indexer.js'
import { readLogFrom } from './session-log.js'
import { observeLiveCall } from './live-calls.js'
import { OtlpMetricsExporter } from './otel-exporter.js'
import { createRatePricer } from './pricing.js'
import { openUsageStore, type UsageStore } from './store.js'

const INDEX_INTERVAL_MS = 30_000
const otlpServiceName = OtlpMetricsExporter.serviceName(process.env)
const usageIndexService = createUsageIndexService({ fileSystem: { readdir, stat }, readLogFrom })

const persistenceConfigSchema = z.object({ config: z.object({ root: z.string().min(1) }) })

/** The JSONL backend's configured root, else the default `$DSH_HOME/sessions`. */
const sessionsRoot = (context: Context): string => {
  const parsed = persistenceConfigSchema.safeParse(context.get('sessionPersistence'))
  return parsed.success ? parsed.data.config.root : dshHomePath('sessions')
}

interface ToolRegistrySnapshot {
  readonly toolSources: ReadonlyMap<string, ToolSourceMetadata>
}

interface UsageRuntime {
  readonly store: UsageStore
  readonly pricer: ReturnType<typeof createRatePricer>
  readonly root: string
  readonly readToolRegistry: () => Promise<ToolRegistrySnapshot | undefined>
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
      active.store.pruneTelemetry()
      const toolRegistry = await active.readToolRegistry()
      if (toolRegistry !== undefined)
        active.store.syncToolSources(
          new Map([...toolRegistry.toolSources].map(([name, source]) => [name, { category: source.source, owner: source.owner }] as const)),
        )
      await usageIndexService.indexSessionLogs({ store: active.store, root: active.root, ...toolRegistry })
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
  jevUsage: ({ input }) => requireRuntime().store.jevUsage(input),
  recordJevUsage: createJevUsageRecorder({
    authorize: jevSourceOf,
    record: input => requireRuntime().store.recordJevUsage(input),
  }),
  requests: ({ input }) => requireRuntime().store.requests(input),
  charts: ({ input }) => requireRuntime().store.charts(input),
  status: () => status(requireRuntime()),
  refresh: async () => {
    const active = requireRuntime()
    await runPass(active)
    return status(active)
  },
  activity: ({ input }) => {
    const query = resolveActivityQuery(input)
    return requireRuntime().store.activity({ ...query, eventLimit: query.eventLimit ?? 50 })
  },
  otelMetrics: ({ input }) => requireRuntime().store.otelMetrics({ ...resolveOtelMetricsRange(input), temporality: 'delta', serviceName: otlpServiceName }),
})

const startExporter = (context: Context, store: UsageStore) => {
  const resolution = OtlpMetricsExporter.resolve(process.env)
  const logger = context.logger('usage')
  if (!resolution.enabled && resolution.reason !== 'not-configured') {
    if (resolution.reason === 'invalid-endpoint') logger.warn('OTLP metrics export is off: the configured endpoint is not an http(s) URL')
    return undefined
  }
  return OtlpMetricsExporter.start({
    timing: OtlpMetricsExporter.timing(process.env),
    destination: () => {
      const current = OtlpMetricsExporter.resolve(process.env, { localBaseUrl: localOtlpEndpoint()?.baseUrl })
      return current.enabled ? current.config : undefined
    },
    collect: range => store.otelMetrics({ ...range, temporality: 'cumulative', serviceName: otlpServiceName }),
    onFailure: failure => {
      if (failure.consecutiveFailures === 1) logger.warn('OTLP metrics export failed, backing off: %s', failure.message)
    },
    onRecovery: () => logger.info('OTLP metrics export recovered'),
  })
}

const setupHost = (context: Context): Effect<void> => {
  const store = openUsageStore(dshHomePath('plugins', 'usage', 'usage.db'))
  const accounts = createHostApiClient(context, aiAccountsApi, '@dshfiles/usage')
  const registry = createHostApiClient(context, dshxRegistryApi, '@dshfiles/usage')
  const readToolRegistry = async (): Promise<ToolRegistrySnapshot | undefined> => {
    const result = await registry.safe.list({})
    if (!result.ok) return undefined
    return {
      toolSources: new Map(result.value.tools.map(tool => [tool.name, { source: tool.source, owner: tool.owner?.slice(0, 120) ?? null }] as const)),
    }
  }
  const accountKinds = async (): Promise<ReadonlyMap<string, string>> => {
    const file = await accounts.safe.read()
    return new Map(file.ok ? file.value.accounts.map(account => [account.instanceId, account.kind] as const) : [])
  }
  const active: UsageRuntime = {
    store,
    pricer: createRatePricer({ store, accountKinds }),
    root: sessionsRoot(context),
    readToolRegistry,
    pass: null,
    lastIndexedAt: null,
    lastError: null,
  }
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
  const exporter = startExporter(context, store)
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        clearInterval(timer)
        await exporter?.stop()
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
