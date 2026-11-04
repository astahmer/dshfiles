import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { otlpExportTarget } from '@dshfiles/dshx/tracing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { AlertEngine } from './alerts/alert-engine.js'
import { AlertDb, AlertRepo } from './alerts/alert-repo.js'
import { tracesAlertsApi } from './alerts/alerts-api.js'
import { tracesApi } from './api.js'
import { tracesBoardsApi } from './boards/boards-api.js'
import { SpanBreakdown } from './boards/breakdown.js'
import { ReceiverDiagnosis } from './diagnosis.js'
import { Forwarder, pointsAt } from './forwarder.js'
import { dialableEndpoint, LocalEndpointLive, RunningSessionsLive, ThreadAttentionLive } from './host-edges.js'
import { OtlpIngest } from './otlp-ingest.js'
import { Receiver } from './receiver.js'
import { tracesSettings, TracesSettingsService } from './settings.js'
import { TraceDb, TraceRepo } from './trace-repo.js'
import type { Exporters } from './types.js'
import { AlertWorker, RetentionWorker } from './workers.js'

const exportersOf = (boundPort: number | null): Exporters => {
  const traces = otlpExportTarget({ signal: 'traces' })
  const configured = traces.source === 'environment' && traces.url !== null && URL.canParse(traces.url) ? new URL(traces.url) : null
  return {
    traces,
    metrics: otlpExportTarget({ signal: 'metrics' }),
    environmentPointsHere: configured === null ? null : boundPort !== null && pointsAt(configured, boundPort),
  }
}

const Storage = Layer.unwrap(
  Effect.sync(() =>
    Layer.mergeAll(TraceDb.layerAt(dshHomePath('plugins', 'traces', 'traces.db')), AlertDb.layerAt(dshHomePath('plugins', 'traces', 'alerts.db'))),
  ),
).pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)))

const ReceiverLive = Receiver.layer.pipe(Layer.provide(Layer.mergeAll(OtlpIngest.layer, Forwarder.layer.pipe(Layer.provide(FetchHttpClient.layer)))))

const TracesLive = Layer.mergeAll(RetentionWorker, AlertWorker, LocalEndpointLive).pipe(
  Layer.provideMerge(Layer.mergeAll(ReceiverLive, AlertEngine.layer.pipe(Layer.provide(Layer.mergeAll(ThreadAttentionLive, RunningSessionsLive))))),
  Layer.provideMerge(Layer.mergeAll(TraceRepo.layer, AlertRepo.layer).pipe(Layer.provide(Storage))),
  Layer.provideMerge(Settings.layer(tracesSettings)),
)

const status = Effect.gen(function* () {
  const settings = yield* TracesSettingsService
  const receiver = yield* Receiver
  const repo = yield* TraceRepo
  const current = yield* settings.get
  const listening = yield* receiver.status
  const summary = yield* repo.summary()
  const exporters = exportersOf(listening.boundPort)
  return {
    diagnosis: ReceiverDiagnosis.diagnose({
      mode: current.mode,
      state: listening.state,
      endpoint: dialableEndpoint(listening.address, listening.boundPort),
      configuredPort: listening.configuredPort,
      receiverMessage: listening.message,
      lastReceivedAt: listening.lastReceivedAt,
      exporters,
    }),
    exporters,
    mode: current.mode,
    externalViewerUrl: current.externalViewerUrl.trim() || null,
    ...listening,
    store: {
      ...summary,
      retentionHours: current.retentionHours,
      retentionSpans: current.retentionSpans,
      retentionLogs: current.retentionLogs,
      retentionMetricPoints: current.retentionMetricPoints,
    },
  }
})

/** The dispatch span of a traces API is dropped at ingest, so its children must not exist: they would be stored as orphans on every poll. */
const untraced = Effect.withTracerEnabled(false)

export default DshxPlugin.make({
  name: 'traces',
  settings: [tracesSettings],
  layer: TracesLive,
  apis: [
    Api.bind(tracesApi, {
      list: input => untraced(TraceRepo.use(repo => repo.list(input))),
      trace: input => untraced(TraceRepo.use(repo => repo.trace(input.traceId))),
      stats: input =>
        untraced(TraceRepo.use(repo => repo.stats({ windowMinutes: input.windowMinutes ?? 60, service: input.service, limit: input.limit ?? 100 }))),
      errors: input =>
        untraced(
          TraceRepo.use(repo => Effect.map(repo.errorGroups({ windowMinutes: input.windowMinutes ?? 60, limit: input.limit ?? 50 }), groups => ({ groups }))),
        ),
      status: () => untraced(status),
      logs: input => untraced(TraceRepo.use(repo => repo.searchLogs(input))),
      metrics: input =>
        untraced(
          TraceRepo.use(repo =>
            Effect.map(repo.listMetrics({ windowMinutes: input.windowMinutes ?? 60, service: input.service, search: input.search }), metrics => ({ metrics })),
          ),
        ),
      metric: input =>
        untraced(TraceRepo.use(repo => repo.metricSeries({ name: input.name, service: input.service, windowMinutes: input.windowMinutes ?? 60 }))),
      serviceMap: input => untraced(TraceRepo.use(repo => repo.serviceMap({ windowMinutes: input.windowMinutes ?? 60 }))),
      sessionSummary: input => untraced(TraceRepo.use(repo => repo.sessionSummary(input.sessionId))),
      clear: () => untraced(TraceRepo.use(repo => repo.clear())),
    }),
    Api.bind(tracesAlertsApi, {
      state: input => untraced(AlertEngine.use(engine => engine.snapshot({ historyLimit: input.historyLimit ?? 50 }))),
      feed: input => untraced(AlertEngine.use(engine => engine.feed({ afterId: input.afterId }))),
      save: input => untraced(AlertEngine.use(engine => engine.save(input))),
      mute: input => untraced(AlertEngine.use(engine => engine.mute(input))),
      remove: input => untraced(AlertEngine.use(engine => engine.remove(input.id))),
      evaluate: () => untraced(AlertEngine.use(engine => engine.evaluate())),
    }),
    Api.bind(tracesBoardsApi, { breakdown: input => untraced(SpanBreakdown.compute(input)) }),
  ],
})
