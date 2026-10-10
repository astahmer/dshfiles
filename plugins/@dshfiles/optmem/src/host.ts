import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readFile } from 'node:fs/promises'
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

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Message, ToolHistory } from '@deepseek-ai/dsh-llm'

import { createOptmemRuntime, type HostServices, type OptmemRuntime } from './runtime.ts'
import { optmemSettings, type OptmemSettings } from './settings.ts'
import { createLlmSummarizer, createRouteResolver, type SummarizerPolicy, type SummaryEffort } from './summarizer.ts'
import { createMemoryTools } from './tools.ts'

/** Dispatched only by the dshfiles fork agent loop (tooling/dsh-core/FORK.md); stock DSH never fires it. */
declare module '@deepseek-ai/cordis' {
  interface Events {
    'agent/request-messages'(
      payload: {
        agent: Agent
        turn: number
        step: number
        isFirstStepOfTurn: boolean
        messages: readonly Message[]
        toolHistory: ToolHistory
        signal: AbortSignal
      },
      next: () => Promise<readonly Message[]>,
    ): Promise<readonly Message[]>
  }
}

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

const effortOf = (effort: OptmemSettings['summarizerEffort']): SummaryEffort | undefined => (effort === '' ? undefined : effort)

const summarizerPolicy = (settings: OptmemSettings): SummarizerPolicy => ({
  override:
    settings.summarizerModel.length > 0
      ? { provider: settings.summarizerProvider, model: settings.summarizerModel, effort: effortOf(settings.summarizerEffort) }
      : undefined,
  cheapModels: settings.cheapModels.map(entry => ({ kind: entry.kind, models: entry.models, effort: effortOf(entry.effort) })),
  fallbacks: settings.summarizerFallbacks.map(entry => ({ provider: entry.provider, model: entry.model, effort: effortOf(entry.effort) })),
})

/** AI Accounts may be absent or a different version: anything undecodable means "kind unknown", matched by id prefix instead. */
const accountsFile = Schema.object({
  accounts: Schema.array(Schema.object({ kind: Schema.string().required(), instanceId: Schema.string().required() })).default([]),
})

const accountKind = async (provider: string): Promise<string | undefined> => {
  try {
    const raw: Parameters<typeof accountsFile>[0] = JSON.parse(await readFile(dshHomePath('plugins', 'ai-accounts', 'accounts.json'), 'utf8'))
    return accountsFile(raw).accounts.find(account => account.instanceId === provider)?.kind
  } catch {
    return undefined
  }
}

/** The thread's route, read the way DSH compaction does: the session's latest request header, else the agent's configured provider. */
const sessionProviders = new Map<string, string>()

const hostServices = (ctx: Context): HostServices => {
  const routes = createRouteResolver({
    policy: () => summarizerPolicy(currentSettings()),
    catalog: () => ({
      sessionProvider: async conversationId => {
        const live = sessionProviders.get(conversationId)
        if (live !== undefined) return live
        const sessionQuery = ctx.get('sessionQuery')
        const log = await sessionQuery?.readSession(SessionId(conversationId)).catch(() => undefined)
        const header = log?.events.findLast(event => event.type === 'request/header')
        return header?.type === 'request/header' ? header.data.header.config.provider : undefined
      },
      providerKind: accountKind,
      models: async provider => {
        const llm = ctx.get('llm')
        if (!llm) return []
        return (await llm.listModels(provider).catch(() => [])).map(model => model.id)
      },
    }),
  })
  return {
    has: service => ctx.get(service) !== undefined,
    requestMessagesHook: () => {
      const loop: unknown = ctx.get('agentLoop')
      return (
        typeof loop === 'object' &&
        loop !== null &&
        'forkFeatures' in loop &&
        loop.forkFeatures instanceof Set &&
        loop.forkFeatures.has('agent/request-messages')
      )
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
  ctx.on('session/event', (session, event) => {
    if (event.type === 'request/header') sessionProviders.set(session.id, event.data.header.config.provider)
    active.onSessionEvent(session, event)
  })
  ctx.on('agent/request-messages', async (payload, next) => {
    const derived = await next()
    return (await active.requestMessages({ ...payload, messages: derived })) ?? derived
  })
  ctx.on('agent/created', ({ agent }) => {
    const provider = agent.session.requestHeader()?.config.provider ?? agent.options.provider
    if (provider !== undefined && provider.length > 0) sessionProviders.set(agent.session.id, provider)
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
