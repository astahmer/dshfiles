import { readdir, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { Cause, Context as EffectContext, Duration, Effect, Layer, Schema } from 'effect'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-llm'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { dshxRegistryApi } from '@dshfiles/dshx/api'
import { PluginApiError } from '@dshfiles/dshx/api'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { localOtlpEndpoint } from '@dshfiles/dshx/tracing'
import { resolveActivityQuery, resolveOtelMetricsRange, usageApi } from './api.js'
import type { ToolSourceMetadata } from './fold.js'
import { toolSourceSnapshotsEqual } from './tool-source-snapshots.js'
import { jevSourceOf } from './jev-usage-recorder.js'
import { createUsageIndexService } from './indexer.js'
import { readLogFrom } from './session-log.js'
import { observeLiveCall } from './live-calls.js'
import { OtlpMetricsExporter } from './otel-exporter.js'
import { createRatePricer } from './pricing.js'
import { openUsageStore, type UsageStore } from './store.js'

const INDEX_INTERVAL_MS = 30_000
const otlpServiceName = OtlpMetricsExporter.serviceName(process.env)
const usageIndexService = createUsageIndexService({ fileSystem: { readdir, stat }, readLogFrom })

const persistenceConfigSchema = Schema.Struct({ config: Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }) })

/** The JSONL backend's configured root, else the default `$DSH_HOME/sessions`. */
const sessionsRoot = (context: Context): string => {
  const persistence = context.get('sessionPersistence')
  return Schema.is(persistenceConfigSchema)(persistence) ? persistence.config.root : dshHomePath('sessions')
}

interface ToolRegistrySnapshot {
  readonly toolSources: ReadonlyMap<string, ToolSourceMetadata>
}

interface UsageRuntimeState {
  readonly store: UsageStore
  readonly pricer: ReturnType<typeof createRatePricer>
  readonly root: string
  readonly readToolRegistry: () => Promise<ToolRegistrySnapshot | undefined>
  syncedToolSources: ReadonlyMap<string, ToolSourceMetadata> | undefined
  pass: Promise<void> | null
  lastIndexedAt: number | null
  lastError: string | null
}

class UsageRuntime extends EffectContext.Service<UsageRuntime, UsageRuntimeState>()('dshfiles/usage/UsageRuntime') {}

class UsageStoreFailure extends Schema.TaggedError<UsageStoreFailure>()('UsageStoreFailure', {
  message: Schema.String,
}) {}

const storeOperation = <Output>(operation: () => Output) =>
  Effect.try({ try: operation, catch: () => new UsageStoreFailure({ message: 'The local usage store could not complete this request.' }) })

const runPass = (active: UsageRuntimeState): Promise<void> => {
  if (active.pass !== null) return active.pass
  const pass = (async () => {
    try {
      active.store.pruneTelemetry()
      const toolRegistry = await active.readToolRegistry()
      if (toolRegistry !== undefined && !toolSourceSnapshotsEqual({ previous: active.syncedToolSources, next: toolRegistry.toolSources })) {
        active.store.syncToolSources(
          new Map([...toolRegistry.toolSources].map(([name, source]) => [name, { category: source.source, owner: source.owner }] as const)),
        )
        active.syncedToolSources = toolRegistry.toolSources
      }
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

const status = (active: UsageRuntimeState) => {
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

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: (context: Context) =>
    Layer.effect(
      UsageRuntime,
      Effect.acquireRelease(
        Effect.sync(() => {
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
          return {
            store,
            pricer: createRatePricer({ store, accountKinds }),
            root: sessionsRoot(context),
            readToolRegistry,
            syncedToolSources: undefined,
            pass: null,
            lastIndexedAt: null,
            lastError: null,
          }
        }),
        active =>
          Effect.promise(async () => {
            await active.pass
            active.store.close()
          }),
      ),
    ),
  setup: (context: Context) =>
    Effect.gen(function* () {
      const active = yield* UsageRuntime
      yield* Effect.sync(() =>
        context.on(
          'llm/stream',
          (options, next) =>
            observeLiveCall({
              options,
              next,
              record: row => active.store.insertLiveCall(row),
            }),
          { global: true },
        ),
      )
      yield* indexLoop(active, context).pipe(Effect.forkScoped)
      const exporter = startExporter(context, active.store)
      if (exporter !== undefined) yield* exporter.pipe(Effect.forkScoped)
    }),
})

const api = hostApi(usageApi, {
  jevUsage: Effect.fn('usage Jev report')(({ input }) =>
    Effect.gen(function* () {
      const active = yield* UsageRuntime
      return yield* storeOperation(() => active.store.jevUsage(input))
    }),
  ),
  recordJevUsage: Effect.fn('usage Jev record')(({ input, caller }) =>
    Effect.gen(function* () {
      if (!jevSourceOf(caller, input.source))
        return yield* Effect.fail(new PluginApiError('Only the Jev source plugin may record its own usage.', { code: 'jev-caller' }))
      const active = yield* UsageRuntime
      yield* storeOperation(() => active.store.recordJevUsage(input))
      return { accepted: true as const }
    }),
  ),
  requests: Effect.fn('usage requests read')(({ input }) =>
    Effect.gen(function* () {
      const active = yield* UsageRuntime
      return yield* storeOperation(() => active.store.requests(input))
    }),
  ),
  charts: Effect.fn('usage charts read')(({ input }) =>
    Effect.gen(function* () {
      const active = yield* UsageRuntime
      return yield* storeOperation(() => active.store.charts(input))
    }),
  ),
  status: Effect.fn('usage status read')(() =>
    Effect.gen(function* () {
      const active = yield* UsageRuntime
      return yield* storeOperation(() => status(active))
    }),
  ),
  refresh: Effect.fn('usage reindex')(({ signal: _signal }) =>
    Effect.gen(function* () {
      const active = yield* UsageRuntime
      yield* Effect.tryPromise({ try: () => runPass(active), catch: () => new UsageStoreFailure({ message: 'The local usage index could not be refreshed.' }) })
      return yield* storeOperation(() => status(active))
    }),
  ),
  activity: Effect.fn('usage activity report')(({ input }) =>
    Effect.gen(function* () {
      const query = resolveActivityQuery(input)
      const active = yield* UsageRuntime
      return yield* storeOperation(() => active.store.activity({ ...query, eventLimit: query.eventLimit ?? 50 }))
    }),
  ),
  otelMetrics: Effect.fn('usage OTLP metrics read')(({ input }) =>
    Effect.gen(function* () {
      const active = yield* UsageRuntime
      return yield* storeOperation(() => active.store.otelMetrics({ ...resolveOtelMetricsRange(input), temporality: 'delta', serviceName: otlpServiceName }))
    }),
  ),
})

const startExporter = (context: Context, store: UsageStore) => {
  const resolution = OtlpMetricsExporter.resolve(process.env)
  const logger = context.logger('usage')
  if (!resolution.enabled && resolution.reason !== 'not-configured') {
    if (resolution.reason === 'invalid-endpoint') logger.warn('OTLP metrics export is off: the configured endpoint is not an http(s) URL')
    return undefined
  }
  return OtlpMetricsExporter.effect({
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

const indexLoop = (active: UsageRuntimeState, context: Context) =>
  Effect.forever(
    Effect.gen(function* () {
      yield* Effect.tryPromise({ try: () => runPass(active), catch: error => error }).pipe(
        Effect.catchCause(cause =>
          Effect.sync(() => {
            context.logger.warn('usage: indexing pass failed: %s', Cause.squash(cause))
          }),
        ),
      )
      yield* Effect.sleep(Duration.millis(INDEX_INTERVAL_MS))
    }),
  )

const host = defineHost({
  ...effectPlugin,
  name: 'usage',
  apis: [api],
})

export default host
