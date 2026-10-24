import type { Context, Effect } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { otlpExportTarget, publishLocalOtlpEndpoint } from '@dshfiles/dshx/tracing'
import { alertsApiHost, startAlerts } from './alerts/alerts-host.js'
import { tracesApi } from './api.js'
import { createBoardsApiHost } from './boards/boards-host.js'
import { ReceiverDiagnosis } from './diagnosis.js'
import { OtlpBody } from './otlp/decode.js'
import { SpanNormalizer } from './otlp/normalize.js'
import { OtlpReceiver, type Receiver, type ReceiverConfig } from './receiver.js'
import { tracesSettings, type TracesSettings } from './settings.js'
import { openTraceStore, type Retention, type TraceStore } from './store.js'
import type { Exporters } from './types.js'

const PRUNE_INTERVAL_MS = 10 * 60_000

type TracesRuntime = { readonly store: TraceStore; readonly receiver: Receiver }

let runtime: TracesRuntime | undefined
let settingsScope: SettingsScope<TracesSettings> | undefined
const defaultSettings: TracesSettings = tracesSettings.schema({})

const currentSettings = (): TracesSettings => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

const requireRuntime = (): TracesRuntime => {
  if (runtime === undefined) throw new Error('The traces Host is not active.')
  return runtime
}

const retentionOf = (settings: TracesSettings): Retention => ({
  maxAgeHours: settings.retentionHours,
  maxSpans: settings.retentionSpans,
  maxLogs: settings.retentionLogs,
  maxMetricPoints: settings.retentionMetricPoints,
})

const receiverConfigOf = (settings: TracesSettings): ReceiverConfig => ({
  enabled: settings.mode !== 'external',
  host: settings.host.trim() || '127.0.0.1',
  allowNonLoopback: settings.allowNonLoopback,
  port: settings.port,
  forwardUrl: settings.mode === 'both' ? settings.forwardUrl : '',
})

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]'])

/** The URL a client of this process dials: a wildcard listen address is reached on loopback. */
const dialableEndpoint = (address: string, port: number | null): string | null => {
  if (port === null) return null
  const host = WILDCARD_HOSTS.has(address) ? '127.0.0.1' : address
  return `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${String(port)}`
}

const exportersOf = (boundPort: number | null): Exporters => {
  const traces = otlpExportTarget({ signal: 'traces' })
  const configured = traces.source === 'environment' && traces.url !== null && URL.canParse(traces.url) ? new URL(traces.url) : null
  return {
    traces,
    metrics: otlpExportTarget({ signal: 'metrics' }),
    environmentPointsHere: configured === null ? null : boundPort !== null && OtlpReceiver.pointsAt(configured, boundPort),
  }
}

let withdrawEndpoint: () => void = () => undefined

/** Publish the bound receiver to this process's exporters while it listens in plugin or both mode; withdraw it otherwise. */
const syncLocalEndpoint = (receiver: Receiver): void => {
  withdrawEndpoint()
  withdrawEndpoint = () => undefined
  const status = receiver.status()
  const endpoint = dialableEndpoint(status.address, status.boundPort)
  if (status.state !== 'listening' || endpoint === null || currentSettings().mode === 'external') return
  withdrawEndpoint = publishLocalOtlpEndpoint({ baseUrl: endpoint, owner: '@dshfiles/traces' })
}

const applySettings = (settings: TracesSettings): void => {
  void runtime?.receiver.apply(receiverConfigOf(settings))
}

const ownedSettings = tracesSettings.host({
  setup: scope => {
    settingsScope = scope
    applySettings(currentSettings())
    const stopWatching = scope.watch(next => applySettings(next))
    return () => {
      stopWatching()
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

const api = tracesApi.host({
  list: ({ input }) => requireRuntime().store.list(input),
  trace: ({ input }) => requireRuntime().store.trace(input.traceId),
  stats: ({ input }) => requireRuntime().store.stats({ windowMinutes: input.windowMinutes ?? 60, service: input.service, limit: input.limit ?? 100 }),
  errors: ({ input }) => ({ groups: requireRuntime().store.errorGroups({ windowMinutes: input.windowMinutes ?? 60, limit: input.limit ?? 50 }) }),
  status: () => {
    const active = requireRuntime()
    const settings = currentSettings()
    const receiver = active.receiver.status()
    const exporters = exportersOf(receiver.boundPort)
    return {
      diagnosis: ReceiverDiagnosis.diagnose({
        mode: settings.mode,
        state: receiver.state,
        endpoint: dialableEndpoint(receiver.address, receiver.boundPort),
        configuredPort: receiver.configuredPort,
        receiverMessage: receiver.message,
        lastReceivedAt: receiver.lastReceivedAt,
        exporters,
      }),
      exporters,
      mode: settings.mode,
      externalViewerUrl: settings.externalViewerUrl.trim() || null,
      ...receiver,
      store: {
        ...active.store.summary(),
        retentionHours: settings.retentionHours,
        retentionSpans: settings.retentionSpans,
        retentionLogs: settings.retentionLogs,
        retentionMetricPoints: settings.retentionMetricPoints,
      },
    }
  },
  logs: ({ input }) => requireRuntime().store.searchLogs(input),
  metrics: ({ input }) => ({
    metrics: requireRuntime().store.listMetrics({ windowMinutes: input.windowMinutes ?? 60, service: input.service, search: input.search }),
  }),
  metric: ({ input }) => requireRuntime().store.metricSeries({ name: input.name, service: input.service, windowMinutes: input.windowMinutes ?? 60 }),
  serviceMap: ({ input }) => requireRuntime().store.serviceMap({ windowMinutes: input.windowMinutes ?? 60 }),
  sessionSummary: ({ input }) => requireRuntime().store.sessionSummary(input.sessionId),
  clear: () => requireRuntime().store.clear(),
})

const boardsApi = createBoardsApiHost(() => requireRuntime().store)

const setupHost = (context: Context): Effect<void> => {
  const logger = context.logger('traces')
  const store = openTraceStore({ path: dshHomePath('plugins', 'traces', 'traces.db') })
  const receiver = OtlpReceiver.create({
    handlers: {
      traces: input => {
        const normalized = SpanNormalizer.normalizeTraces(OtlpBody.decodeTraces(input), { redactContent: currentSettings().redactGenAiContent })
        store.ingest(normalized.spans, retentionOf(currentSettings()))
        return { accepted: normalized.spans.length, rejected: normalized.rejected }
      },
      logs: input => {
        const settings = currentSettings()
        const normalized = SpanNormalizer.normalizeLogs(OtlpBody.decodeLogs(input), { redactContent: settings.redactGenAiContent })
        store.ingestLogs(normalized.logs, retentionOf(settings))
        return { accepted: normalized.logs.length, rejected: normalized.rejected }
      },
      metrics: input => {
        const settings = currentSettings()
        const normalized = SpanNormalizer.normalizeMetrics(OtlpBody.decodeMetrics(input), { redactContent: settings.redactGenAiContent })
        store.ingestMetrics(normalized.points, retentionOf(settings))
        return { accepted: normalized.points.length, rejected: normalized.rejected }
      },
    },
    onWarning: warning => logger.warn(warning),
    onStateChange: () => {
      if (runtime?.receiver === receiver) syncLocalEndpoint(receiver)
    },
  })
  const active: TracesRuntime = { store, receiver }
  runtime = active
  applySettings(currentSettings())
  const pruneTimer = setInterval(() => store.prune(retentionOf(currentSettings())), PRUNE_INTERVAL_MS)
  pruneTimer.unref()
  const stopAlerts = startAlerts({ context, traces: store, path: dshHomePath('plugins', 'traces', 'alerts.db') })
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        clearInterval(pruneTimer)
        stopAlerts()
        if (runtime === active) {
          runtime = undefined
          withdrawEndpoint()
          withdrawEndpoint = () => undefined
        }
        await receiver.stop()
        store.close()
      }
    },
  }
}

export default defineHost({
  name: 'traces',
  apis: [api, alertsApiHost, boardsApi],
  settings: [ownedSettings],
  setup: setupHost,
})
