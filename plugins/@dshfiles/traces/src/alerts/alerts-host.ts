import type { Context } from '@deepseek-ai/cordis'
import { isApiOwnerMissing, PluginApiError } from '@dshfiles/dshx/api'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { threadSidebarAttentionApi } from '@dshfiles/thread-sidebar/attention-api'
import type { TraceStore } from '../store.js'
import { ALERT_INTERVAL_SECONDS, createAlertEngine, type AlertEngine, type MarkThread } from './alert-engine.js'
import { AlertStoreError, openAlertStore } from './alert-store.js'
import { tracesAlertsApi } from './alerts-api.js'

const FIRST_EVALUATION_DELAY_MS = 15_000

type AlertsRuntime = { readonly engine: AlertEngine }

let runtime: AlertsRuntime | undefined

const requireRuntime = (): AlertsRuntime => {
  if (runtime === undefined) throw new PluginApiError('The traces Host is not active.', { code: 'inactive' })
  return runtime
}

/** Store failures the user can act on reach the client with their message; anything else stays generic. */
const userFacing = <Result>(run: () => Result): Result => {
  try {
    return run()
  } catch (error) {
    if (error instanceof AlertStoreError) throw new PluginApiError(error.message, { code: error.code })
    throw error
  }
}

export const alertsApiHost = tracesAlertsApi.host({
  state: ({ input }) => requireRuntime().engine.snapshot({ historyLimit: input.historyLimit ?? 50 }),
  feed: ({ input }) => requireRuntime().engine.feed({ afterId: input.afterId }),
  save: ({ input }) => userFacing(() => requireRuntime().engine.save(input)),
  mute: ({ input }) => userFacing(() => requireRuntime().engine.mute(input)),
  remove: ({ input }) => userFacing(() => requireRuntime().engine.remove(input.id)),
  evaluate: () => requireRuntime().engine.evaluate(),
})

/** Thread attention goes through thread-sidebar's own contract; without it the alert still fires and says why no thread was marked. */
const threadMarker = (context: Context): MarkThread => {
  const attention = createHostApiClient(context, threadSidebarAttentionApi, '@dshfiles/traces')
  return async sessionId => {
    const result = await attention.safe.markUnread({ sessionId })
    if (result.ok) return true
    if (isApiOwnerMissing(result.error)) return false
    throw new Error(result.error.message)
  }
}

export const startAlerts = (input: { readonly context: Context; readonly traces: TraceStore; readonly path: string }): (() => void) => {
  const logger = input.context.logger('traces')
  const alerts = openAlertStore({ path: input.path })
  const engine = createAlertEngine({
    samples: input.traces,
    alerts,
    markThread: threadMarker(input.context),
    runningSessionIds: () =>
      new Set(
        input.context.agents
          .list()
          .filter(agent => agent.status === 'running')
          .map(agent => String(agent.id)),
      ),
  })
  const active: AlertsRuntime = { engine }
  runtime = active
  const evaluate = (): void => {
    void engine.evaluate().catch((error: unknown) => logger.warn(`alert evaluation failed: ${error instanceof Error ? error.message : String(error)}`))
  }
  const first = setTimeout(evaluate, FIRST_EVALUATION_DELAY_MS)
  const timer = setInterval(evaluate, ALERT_INTERVAL_SECONDS * 1000)
  first.unref()
  timer.unref()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    if (runtime === active) runtime = undefined
    alerts.close()
  }
}
