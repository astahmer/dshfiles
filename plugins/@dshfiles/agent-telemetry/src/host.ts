import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { createPricingCatalog, DEFAULT_PRICING_PATH } from '@dshfiles/ai-accounts/pricing-catalog'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { flushTracing } from '@dshfiles/dshx/tracing'
import { Context, Effect, Layer, Queue, Schedule } from 'effect'
import { createCoordinator } from './coordinator.js'
import { createCallPricer } from './cost.js'
import { GenAi } from './genai.js'
import { agentTelemetrySettings, type AgentTelemetrySettings } from './settings.js'
import { AgentTelemetryPricingError, reloadAgentTelemetryPricing } from './telemetry-effect.js'

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

const PRICING_RELOAD_MS = 5 * 60_000
const PRICING_MISS_RETRY_MS = 30_000

interface AgentTelemetryRuntime {
  readonly coordinator: ReturnType<typeof createCoordinator>
  readonly reloadRequests: Queue.Queue<void>
  readonly reloadPricing: Effect.Effect<void, AgentTelemetryPricingError>
}

class AgentTelemetry extends Context.Service<AgentTelemetry, AgentTelemetryRuntime>()('dshfiles/agent-telemetry/Runtime') {}

const layer = (ctx: CordisContext) =>
  Layer.effect(
    AgentTelemetry,
    Effect.gen(function* () {
      const catalog = createPricingCatalog({ path: DEFAULT_PRICING_PATH })
      const accounts = createHostApiClient(ctx, aiAccountsApi, '@dshfiles/agent-telemetry')
      const reloadRequests = yield* Queue.dropping<void>(1)
      let kinds: ReadonlyMap<string, string> = new Map()
      let lastMissReloadAt = 0
      const reloadPricing = reloadAgentTelemetryPricing({
        load: async () => {
          await catalog.load()
          const file = await accounts.safe.read().catch(() => undefined)
          if (file?.ok === true) kinds = new Map(file.value.accounts.map(account => [account.instanceId, account.kind] as const))
        },
      })
      const currentCatalog = () => {
        const cache = catalog.current()
        if (cache === null && Date.now() - lastMissReloadAt > PRICING_MISS_RETRY_MS) {
          lastMissReloadAt = Date.now()
          Queue.offerUnsafe(reloadRequests, undefined)
        }
        return cache
      }
      const priceCall = createCallPricer({ catalog: currentCatalog, accountKind: provider => kinds.get(provider) })
      const coordinator = createCoordinator({ captureContent, priceCall, warn: message => ctx.logger('agent-telemetry').warn(message) })
      for (const session of ctx.sessions.list()) coordinator.adopt(session)
      return yield* Effect.acquireRelease(Effect.succeed({ coordinator, reloadRequests, reloadPricing }), active =>
        Effect.promise(async () => {
          active.coordinator.closeAll()
          await flushTracing()
        }),
      )
    }),
  )

const effectSetup = DshxEffect.plugin({
  layer,
  setup: ctx =>
    Effect.gen(function* () {
      const active = yield* AgentTelemetry
      const logger = ctx.logger('agent-telemetry')
      const reloadAndReport = active.reloadPricing.pipe(Effect.catch(error => Effect.sync(() => logger.warn(`${error._tag}: pricing catalog reload failed.`))))
      yield* Effect.forkScoped(Effect.repeat(reloadAndReport, Schedule.spaced(`${PRICING_RELOAD_MS} millis`)))
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            yield* Queue.take(active.reloadRequests)
            yield* reloadAndReport
          }),
        ),
      )
      yield* Effect.acquireRelease(
        Effect.sync(() => [
          ctx.on('session/created', session => active.coordinator.onCreated(session)),
          ctx.on('session/event', (session, event) => active.coordinator.onEvent(session, event)),
          ctx.on('session/disposed', session => active.coordinator.onDisposed(session)),
          ctx.on('tools/execute', (exec, next) => active.coordinator.runTool(exec, next)),
          ctx.on('llm/stream', (options, next) => active.coordinator.interceptLlm(options, next)),
        ]),
        disposers =>
          Effect.sync(() => {
            for (const dispose of disposers.reverse()) dispose()
          }),
      )
    }),
}).setup

export default defineHost({
  name: 'agent-telemetry',
  inject: ['sessions'],
  settings: [ownedSettings],
  setup: effectSetup,
})
