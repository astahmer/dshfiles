import type { Context, Effect } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { flushTracing } from '@dshfiles/dshx/tracing'
import { createCoordinator } from './coordinator.js'
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
const setupHost = (ctx: Context): Effect<void> => {
  const logger = ctx.logger('agent-telemetry')
  const coordinator = createCoordinator({ captureContent, warn: message => logger.warn(message) })
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
