import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { DEFAULT_PRICING_PATH } from '@dshfiles/ai-accounts/pricing-catalog'
import { dshxRegistryApi } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { localOtlpEndpoint } from '@dshfiles/dshx/tracing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Clock, Effect, Layer, Option, Schedule, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { resolveActivityQuery, resolveOtelMetricsRange, usageApi } from './api.js'
import { SessionLogFiles, SessionLogIndex } from './indexer.js'
import { Indexer, ToolRegistry } from './indexing.js'
import { recordJevUsage } from './jev-usage-recorder.js'
import { observeLiveCall } from './live-calls.js'
import { OtlpExporter, OtlpMetricsExporter } from './otel-exporter.js'
import { AccountKinds, Pricing } from './pricing.js'
import { UsageRepo } from './store.js'

const INDEX_INTERVAL = '30 seconds'

/** A read marks demand: the periodic catch-up pass runs only while a panel or an Agent is actually looking. */
const demanded = <A, E, R>(read: Effect.Effect<A, E, R>) => Indexer.use(indexer => Effect.andThen(indexer.touch, read))
const otlpServiceName = OtlpMetricsExporter.serviceName(process.env)

const decodePersistence = Schema.decodeUnknownOption(Schema.Struct({ config: Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }) }))

/** The JSONL backend's configured root, else the default `$DSH_HOME/sessions`. */
const sessionsRoot = Effect.map(Effect.option(hostService('sessionPersistence')), persistence =>
  Option.getOrElse(
    Option.map(Option.flatMap(persistence, decodePersistence), persisted => persisted.config.root),
    () => dshHomePath('sessions'),
  ),
)

const ToolRegistryLive = Layer.effect(
  ToolRegistry,
  Effect.map(HostApis, apis => {
    const registry = apis.client(dshxRegistryApi)
    return ToolRegistry.of({
      snapshot: registry.list({}).pipe(
        Effect.map(listed =>
          Option.some(new Map(listed.tools.map(tool => [tool.name, { source: tool.source, owner: tool.owner?.slice(0, 120) ?? null }] as const))),
        ),
        Effect.catchTag('ApiCallError', () => Effect.succeedNone),
      ),
    })
  }),
)

const AccountKindsLive = Layer.effect(
  AccountKinds,
  Effect.map(HostApis, apis => {
    const accounts = apis.client(aiAccountsApi)
    return AccountKinds.of({
      read: accounts.read().pipe(
        Effect.map(file => new Map(file.accounts.map(account => [account.instanceId, account.kind] as const))),
        Effect.catchTag('ApiCallError', () => Effect.succeed(new Map<string, string>())),
      ),
    })
  }),
)

/** Model calls outside the agent loop, observed on `llm/stream` while the plugin runs; the interceptor body stays synchronous. */
const LiveCalls = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const repo = yield* UsageRepo
    const record = yield* DshxPlugin.callback((row: Parameters<typeof repo.insertLiveCall>[0]) =>
      repo.insertLiveCall(row).pipe(Effect.catchTag('UsageStoreFailed', error => Effect.logWarning('usage: live call not recorded', error.operation))),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => host.ctx.on('llm/stream', (options, next) => observeLiveCall({ options, next, record }), { global: true })),
      dispose => Effect.sync(dispose),
    )
  }),
)

const IndexingLoop = Layer.effectDiscard(
  DshxPlugin.worker(
    Indexer.use(indexer =>
      Effect.gen(function* () {
        if (!(yield* indexer.demanded)) return
        yield* indexer.pass
      }),
    ).pipe(Effect.repeat(Schedule.spaced(INDEX_INTERVAL))),
  ),
)

/** The OTLP exporter, when the environment or the Host's own receiver names a destination; off otherwise. */
const Exporter = Layer.unwrap(
  Effect.sync(() => {
    const resolution = OtlpMetricsExporter.resolve(process.env)
    if (!resolution.enabled && resolution.reason === 'invalid-endpoint')
      return Layer.effectDiscard(Effect.logWarning('usage: OTLP metrics export is off: the configured endpoint is not an http(s) URL'))
    if (!resolution.enabled && resolution.reason === 'disabled') return Layer.effectDiscard(Effect.logDebug('usage: OTLP metrics export is disabled'))
    return OtlpExporter.layer({
      timing: OtlpMetricsExporter.timing(process.env),
      serviceName: otlpServiceName,
      destination: Effect.sync(() => {
        const current = OtlpMetricsExporter.resolve(process.env, { localBaseUrl: localOtlpEndpoint()?.baseUrl })
        return current.enabled ? Option.some(current.config) : Option.none()
      }),
    }).pipe(Layer.provide(FetchHttpClient.layer))
  }),
)

const UsageLive = Layer.unwrap(
  Effect.map(sessionsRoot, root =>
    Layer.mergeAll(IndexingLoop, LiveCalls, Exporter).pipe(
      Layer.provideMerge(Indexer.layer({ sessionsRoot: root })),
      Layer.provideMerge(Layer.mergeAll(SessionLogIndex.layer, Pricing.layer({ catalogPath: DEFAULT_PRICING_PATH }))),
      Layer.provideMerge(UsageRepo.layer),
      Layer.provide([SessionLogFiles.layer, ToolRegistryLive, AccountKindsLive]),
      Layer.provide([HostApis.layer, NodeFileSystem.layer, NodePath.layer]),
    ),
  ),
)

export default DshxPlugin.make({
  name: 'usage',
  layer: UsageLive,
  apis: [
    Api.bind(usageApi, {
      requests: input => demanded(UsageRepo.use(repo => repo.requests(input))),
      charts: input => demanded(UsageRepo.use(repo => repo.charts(input))),
      status: () => demanded(Indexer.use(indexer => indexer.status)),
      refresh: () => Indexer.use(indexer => Effect.andThen(indexer.pass, indexer.status)),
      jevUsage: input => demanded(UsageRepo.use(repo => repo.jevUsage(input))),
      recordJevUsage: (input, call) => recordJevUsage({ record: input, caller: call.caller }),
      activity: input =>
        demanded(
          Effect.gen(function* () {
            const query = yield* Effect.fromResult(resolveActivityQuery(input, yield* Clock.currentTimeMillis))
            return yield* UsageRepo.use(repo => repo.activity({ ...query, eventLimit: query.eventLimit ?? 50 }))
          }),
        ),
      otelMetrics: input =>
        demanded(
          Effect.gen(function* () {
            const range = yield* Effect.fromResult(resolveOtelMetricsRange(input, yield* Clock.currentTimeMillis))
            return yield* UsageRepo.use(repo => repo.otelMetrics({ ...range, temporality: 'delta', serviceName: otlpServiceName }))
          }),
        ),
    }),
  ],
})
