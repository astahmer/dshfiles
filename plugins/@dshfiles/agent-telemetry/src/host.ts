import type { Context, Effect } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { createPricingCatalog, DEFAULT_PRICING_PATH } from '@dshfiles/ai-accounts/pricing-catalog'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { flushTracing } from '@dshfiles/dshx/tracing'
import { createCoordinator } from './coordinator.js'
import { createCallPricer } from './cost.js'
import { GenAi } from './genai.js'
import { agentTelemetrySettings, type AgentTelemetrySettings } from './settings.js'

let settingsScope: SettingsScope<AgentTelemetrySettings> | undefined
const defaultSettings: AgentTelemetrySettings = agentTelemetrySettings.schema({})

const currentSettings = (): AgentTelemetrySettings => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

const captureContent = (): boolean => {
  const mode = currentSettings().captureContent
  if (mode === 'environment') return GenAi.contentCaptureFromEnvironment(process.env)
  return mode === 'on'
}

const ownedSettings = agentTelemetrySettings.host({
  setup: scope => {
    settingsScope = scope
    return () => {
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

/**
 * Always on: spans are no-ops until dshx tracing has a destination (an `OTEL_EXPORTER_OTLP_*` endpoint or the traces
 * plugin's in-process receiver), so no launch environment gates this row.
 */
const PRICING_RELOAD_MS = 5 * 60_000
const PRICING_MISS_RETRY_MS = 30_000

/**
 * Reads AI Accounts' models.dev cache (AI Accounts owns fetching it) and its account kinds, so subscription routes
 * resolve the same quote as the usage ledger. Both reload in the background; a model call is priced with whatever was
 * loaded when its stream finished, never by waiting on disk or another plugin.
 */
const startPricing = (ctx: Context) => {
  const catalog = createPricingCatalog({ path: DEFAULT_PRICING_PATH })
  const accounts = createHostApiClient(ctx, aiAccountsApi, '@dshfiles/agent-telemetry')
  let kinds: ReadonlyMap<string, string> = new Map()
  const reload = async (): Promise<void> => {
    await catalog.load()
    const file = await accounts.safe.read().catch(() => undefined)
    if (file?.ok === true) kinds = new Map(file.value.accounts.map(account => [account.instanceId, account.kind] as const))
  }
  void reload()
  const timer = setInterval(() => void reload(), PRICING_RELOAD_MS)
  timer.unref()
  // On a fresh home AI Accounts writes the catalog after this Host started: retry soon instead of waiting minutes.
  let lastMissReloadAt = 0
  const currentCatalog = () => {
    const cache = catalog.current()
    if (cache === null && Date.now() - lastMissReloadAt > PRICING_MISS_RETRY_MS) {
      lastMissReloadAt = Date.now()
      void reload()
    }
    return cache
  }
  return {
    priceCall: createCallPricer({ catalog: currentCatalog, accountKind: provider => kinds.get(provider) }),
    dispose: () => clearInterval(timer),
  }
}

const setupHost = (ctx: Context): Effect<void> => {
  const logger = ctx.logger('agent-telemetry')
  const pricing = startPricing(ctx)
  const coordinator = createCoordinator({ captureContent, warn: message => logger.warn(message), priceCall: pricing.priceCall })
  for (const session of ctx.sessions.list()) coordinator.adopt(session)
  const disposers = [
    ctx.on('session/created', session => coordinator.onCreated(session)),
    ctx.on('session/event', (session, event) => coordinator.onEvent(session, event)),
    ctx.on('session/disposed', session => coordinator.onDisposed(session)),
    ctx.on('tools/execute', (exec, next) => coordinator.runTool(exec, next)),
    ctx.on('llm/stream', (options, next) => coordinator.interceptLlm(options, next)),
  ]
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        for (const dispose of disposers.reverse()) dispose()
        pricing.dispose()
        coordinator.closeAll()
        await flushTracing()
      }
    },
  }
}

export default defineHost({
  name: 'agent-telemetry',
  inject: ['sessions'],
  settings: [ownedSettings],
  setup: setupHost,
})
