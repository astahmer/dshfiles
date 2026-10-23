import type { Context, Effect } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { tracesApi } from './api.js'
import { OtlpBody } from './otlp/decode.js'
import { SpanNormalizer } from './otlp/normalize.js'
import { OtlpReceiver, type Receiver, type ReceiverConfig } from './receiver.js'
import { tracesSettings, type TracesSettings } from './settings.js'
import { openTraceStore, type Retention, type TraceStore } from './store.js'

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

const retentionOf = (settings: TracesSettings): Retention => ({ maxAgeHours: settings.retentionHours, maxSpans: settings.retentionSpans })

const receiverConfigOf = (settings: TracesSettings): ReceiverConfig => ({
  enabled: settings.mode !== 'external',
  host: settings.host.trim() || '127.0.0.1',
  allowNonLoopback: settings.allowNonLoopback,
  port: settings.port,
  forwardUrl: settings.mode === 'both' ? settings.forwardUrl : '',
})

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
    return {
      mode: settings.mode,
      externalViewerUrl: settings.externalViewerUrl.trim() || null,
      ...active.receiver.status(),
      store: { ...active.store.summary(), retentionHours: settings.retentionHours, retentionSpans: settings.retentionSpans },
    }
  },
  clear: () => requireRuntime().store.clear(),
})

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
      metrics: () => ({ accepted: 0, rejected: 0 }),
    },
    onWarning: warning => logger.warn(warning),
  })
  const active: TracesRuntime = { store, receiver }
  runtime = active
  applySettings(currentSettings())
  const pruneTimer = setInterval(() => store.prune(retentionOf(currentSettings())), PRUNE_INTERVAL_MS)
  pruneTimer.unref()
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        clearInterval(pruneTimer)
        if (runtime === active) runtime = undefined
        await receiver.stop()
        store.close()
      }
    },
  }
}

export default defineHost({
  name: 'traces',
  apis: [api],
  settings: [ownedSettings],
  setup: setupHost,
})
