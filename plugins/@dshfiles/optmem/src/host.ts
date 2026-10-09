import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { defineCommand, defineHost, definePromptContext } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'

import { createOptmemRuntime, type HostServices, type OptmemRuntime } from './runtime.ts'
import { optmemSettings, type OptmemSettings } from './settings.ts'
import { createLlmSummarizer, createRouteResolver } from './summarizer.ts'
import { createMemoryTools } from './tools.ts'

let runtime: OptmemRuntime | undefined
let settingsScope: SettingsScope<OptmemSettings> | undefined

const defaultSettings: OptmemSettings = optmemSettings.schema({})

/** The settings entry can be absent while the Loader is still composing it; schema defaults stand in until it appears. */
let settingsSource: 'entry' | 'defaults' = 'defaults'

const currentSettings = (): OptmemSettings => {
  try {
    const value = settingsScope?.get()
    settingsSource = value === undefined ? 'defaults' : 'entry'
    return value ?? defaultSettings
  } catch {
    settingsSource = 'defaults'
    return defaultSettings
  }
}

const ownedSettings = optmemSettings.host({
  setup: scope => {
    settingsScope = scope
    const stopWatching = scope.watch(next => void runtime?.applySettings(next))
    return () => {
      stopWatching()
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

const memoryContext = definePromptContext({
  name: 'dshfiles-optmem:memory',
  order: 900,
  text: context => runtime?.promptText(context.agent) ?? '',
})

const backfillCommand = defineCommand({
  name: 'optmem-backfill',
  description: 'Import existing DSH sessions into OptMem memory (bounded and resumable; default 20 sessions per run).',
  input: { hint: '[sessions]' },
  handler: async invocation => {
    try {
      if (!runtime) return { kind: 'error', text: 'OptMem is not active in this DSH host.' }
      const requested = Number.parseInt(invocation.rawInput.trim(), 10)
      const limit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 500) : 20
      return { kind: 'success', text: await runtime.backfill(limit) }
    } catch (error) {
      return { kind: 'error', text: `OptMem backfill failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
})

const hostServices = (ctx: Context): HostServices => {
  const routes = createRouteResolver({
    catalog: () => {
      const llm = ctx.get('llm')
      if (!llm) return undefined
      return { providers: () => llm.listProviders().map(provider => provider.id), models: async provider => (await llm.listModels(provider)).map(model => model.id) }
    },
    target: () => {
      const settings = currentSettings()
      return { provider: settings.summarizerProvider, model: settings.summarizerModel, effort: settings.summarizerEffort }
    },
  })
  return {
    has: service => ctx.get(service) !== undefined,
    requestMessagesHook: () => {
      const loop: unknown = ctx.get('agentLoop')
      return typeof loop === 'object' && loop !== null && 'forkFeatures' in loop && loop.forkFeatures instanceof Set && loop.forkFeatures.has('agent/request-messages')
    },
    workspaceId: async path => (await ctx.get('workspaceRegistry')?.resolveByPath(path))?.id,
    sessionLogs: () => {
      const sessionQuery = ctx.get('sessionQuery')
      if (!sessionQuery) return undefined
      return { listSessions: () => sessionQuery.listSessions(), readSession: sessionId => sessionQuery.readSession(SessionId(sessionId)) }
    },
    createSummarizer: () =>
      createLlmSummarizer({
        stream: call => {
          const llm = ctx.get('llm')
          if (!llm) throw new Error('the DSH llm service is unavailable')
          return llm.stream(call)
        },
        resolveRoute: routes.resolve,
        timeoutMs: () => currentSettings().summarizerTimeoutMs,
      }),
    summarizerRoute: routes.current,
  }
}

const setup = (ctx: Context): void => {
  const active = createOptmemRuntime({
    services: hostServices(ctx),
    databasePath: dshHomePath('plugins', 'optmem', 'optmem.db'),
    settings: currentSettings,
    settingsSource: () => settingsSource,
    logger: ctx.logger('optmem'),
  })
  runtime = active
  ctx.on('session/event', (session, event) => active.onSessionEvent(session, event))
  ctx.on('agent/created', ({ agent }) => {
    void active.resolveProject(agent.session.header)
    return undefined
  })
  ctx.effect(async () => {
    await active.start()
    return async () => {
      if (runtime === active) runtime = undefined
      await active.stop()
    }
  }, 'optmem runtime')
}

export default defineHost({
  name: '@dshfiles/optmem',
  tools: createMemoryTools(() => runtime),
  commands: [backfillCommand],
  prompts: [memoryContext],
  settings: [ownedSettings],
  setup,
})
