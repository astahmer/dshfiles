import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readFile, stat } from 'node:fs/promises'
import type {} from '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { StreamIds, TreeMath } from '@dshfiles/optmem-core'
import { defineCommand, defineHost, definePromptContext } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Message, ToolHistory } from '@deepseek-ai/dsh-llm'

import { optmemApi, type OptmemExplorerZoom, type OptmemOverview, type OptmemProject, type OptmemProvider } from './api.ts'
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
  paused: settings.summarizerPaused,
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

const databasePath = (): string => dshHomePath('plugins', 'optmem', 'optmem.db')

let hostContext: Context | undefined

const databaseBytes = async (path: string): Promise<number | null> => {
  const sizes = await Promise.all(
    ['', '-wal', '-shm'].map(suffix =>
      stat(`${path}${suffix}`).then(
        file => file.size,
        () => null,
      ),
    ),
  )
  return sizes[0] === null ? null : sizes.reduce<number>((total, size) => total + (size ?? 0), 0)
}

const overview = async (): Promise<OptmemOverview> => {
  const path = databasePath()
  const requestedMode = currentSettings().mode === 'full' ? 'full' : 'compatibility'
  const bytes = await databaseBytes(path)
  if (!runtime)
    return {
      state: 'off',
      failure: 'OptMem is not active in this DSH host.',
      requestedMode,
      activeMode: 'compatibility',
      fullModeAvailable: false,
      settingsSource,
      database: { path, bytes },
      events: null,
      streams: null,
      summaryCalls: null,
      pendingSummaries: null,
      pendingMerges: null,
      captured: 0,
      skipped: 0,
      queued: 0,
      lastRoute: { kind: 'unresolved' },
      lastError: null,
      retryInMs: null,
    }
  const host = runtime.status()
  const memory =
    host.state === 'ready'
      ? await runtime
          .requireEngine()
          .status()
          .catch(() => undefined)
      : undefined
  const persisted = host.state === 'ready' ? runtime.pipelineOverview() : undefined
  const pipeline =
    memory === undefined || persisted === undefined
      ? undefined
      : {
          ...persisted,
          paused: currentSettings().summarizerPaused,
          health: !currentSettings().enabled
            ? ('off' as const)
            : host.state === 'starting'
              ? ('starting' as const)
              : currentSettings().summarizerPaused
                ? ('paused' as const)
                : memory.failures.count > 0
                  ? ('degraded' as const)
                  : memory.queue.running > 0
                    ? ('processing' as const)
                    : persisted.pendingLeafJobs + persisted.pendingMergeJobs > 0
                      ? ('waiting' as const)
                      : ('idle' as const),
        }
  const route = host.summarizer
  return {
    state: host.state,
    failure: host.failure,
    requestedMode,
    activeMode: requestedMode === 'full' && host.mode.ok ? 'full' : 'compatibility',
    fullModeAvailable: host.capabilities.replaceContext && host.capabilities.resetPerTurn,
    settingsSource: host.settings,
    database: { path, bytes },
    events: memory ? memory.streams.reduce((total, stream) => total + stream.length, 0) : null,
    uniqueEvents: persisted?.uniqueEvents ?? null,
    streams: memory ? memory.streams.length : null,
    summaryCalls: memory ? memory.summarizer.calls : null,
    pendingSummaries: memory ? memory.queue.leaves + memory.queue.parents + memory.queue.running + memory.failures.count : null,
    pendingMerges: memory ? memory.streams.filter(stream => stream.mergePending).length : null,
    ...(pipeline === undefined ? {} : { pipeline }),
    captured: host.captured,
    skipped: host.skipped,
    queued: host.queued,
    lastRoute:
      route.kind === 'ready'
        ? { kind: 'ready', source: route.source, conversationId: route.conversationId, route: { ...route.route, effort: route.route.effort ?? null } }
        : route,
    lastError: (memory && memory.failures.count > 0 ? memory.failures.lastError : null) ?? host.lastCaptureError ?? null,
    retryInMs: memory?.failures.retryInMs ?? null,
  }
}

const providers = async (): Promise<readonly OptmemProvider[]> => {
  const llm = hostContext?.get('llm')
  if (!llm) return []
  return Promise.all(
    llm.listProviders().map(async provider => ({
      id: provider.id,
      name: provider.name,
      kind: (await accountKind(provider.id)) ?? null,
      models: (await llm.listModels(provider.id).catch(() => [])).map(model => model.id),
    })),
  )
}

const explorerProject = async (projectId: string) => {
  if (projectId.length === 0 || projectId.length > 256) throw new Error('Select a valid OptMem project.')
  if (!runtime) throw new Error('OptMem is not active in this DSH host.')
  const stream = StreamIds.project(projectId)
  const workspace = hostContext
    ?.get('workspaceRegistry')
    ?.list()
    .find(item => `workspace:${item.id}` === projectId)
  const streams = (await runtime.requireEngine().status()).streams
  if (!workspace && !streams.some(item => item.stream === stream)) throw new Error('The selected OptMem project is unavailable.')
  return { stream, workspace }
}

const explorerProjects = async (): Promise<readonly OptmemProject[]> => {
  const workspaces = hostContext?.get('workspaceRegistry')?.list() ?? []
  const overview = runtime?.status().state === 'ready' ? await runtime.requireEngine().status() : undefined
  const projectStreams = overview?.streams.filter(item => item.stream.startsWith('project:')) ?? []
  const registered = new Set(workspaces.map(item => `workspace:${item.id}`))
  const projects: OptmemProject[] = workspaces.map(workspace => {
    const projectId = `workspace:${workspace.id}`
    const stream = projectStreams.find(item => item.stream === StreamIds.project(projectId))
    return {
      projectId,
      title: workspace.title,
      path: workspace.path,
      registered: true,
      eventCount: stream?.length ?? 0,
    }
  })
  for (const stream of projectStreams) {
    const projectId = stream.stream.slice('project:'.length)
    if (registered.has(projectId)) continue
    projects.push({ projectId, title: 'Unregistered project', path: null, registered: false, eventCount: stream.length })
  }
  return projects
}

const explorerView = async (projectId: string) => {
  const { stream } = await explorerProject(projectId)
  if (!runtime) return []
  const view = await runtime.requireEngine().readView({ stream, kind: 'main' })
  return view.nodes.flatMap(address => {
    const node = runtime?.inspectNode({ projectId, address: TreeMath.format(address) })
    return node === undefined ? [] : [{ address: node.address, text: node.text, bytes: node.bytes, model: node.model, createdAt: node.createdAt }]
  })
}

const explorerZoom = async (input: {
  readonly projectId: string
  readonly address: string
  readonly page?: number | undefined
}): Promise<OptmemExplorerZoom> => {
  const { stream } = await explorerProject(input.projectId)
  if (!runtime) throw new Error('OptMem is not active in this DSH host.')
  if (input.address.length === 0 || input.address.length > 64) throw new Error('Select a valid memory node.')
  const page = Number.isSafeInteger(input.page) ? Math.max(0, Math.min(input.page ?? 0, 100_000)) : 0
  const zoomed = await runtime.requireEngine().zoom({
    stream,
    address: input.address,
    page,
    access: { conversationId: 'optmem-explorer', projectId: input.projectId, allowAllProjects: false },
  })
  if (zoomed.kind === 'event')
    return {
      kind: 'event',
      address: zoomed.address,
      eventId: zoomed.eventId,
      conversationId: zoomed.conversationId,
      role: zoomed.role,
      createdAt: zoomed.createdAt,
      truncated: zoomed.truncated,
      page: zoomed.page,
      pageCount: zoomed.pageCount,
      text: zoomed.text,
    }
  const metadata = runtime.inspectNode({ projectId: input.projectId, address: zoomed.address })
  if (!metadata) throw new Error('The selected memory node is no longer available.')
  return { kind: 'node', ...metadata, lines: zoomed.lines }
}

const explorerSearch = async (input: {
  readonly projectId: string
  readonly query: string
  readonly offset?: number | undefined
  readonly limit?: number | undefined
}) => {
  await explorerProject(input.projectId)
  if (!runtime) throw new Error('OptMem is not active in this DSH host.')
  const limit = Number.isSafeInteger(input.limit) ? Math.max(1, Math.min(input.limit ?? 25, 50)) : 25
  const offset = Number.isSafeInteger(input.offset) ? Math.max(0, Math.min(input.offset ?? 0, 1_000_000)) : 0
  const hits = await runtime.requireEngine().search({
    query: input.query.slice(0, 512),
    scope: 'project',
    access: { conversationId: 'optmem-explorer', projectId: input.projectId, allowAllProjects: false },
    limit: limit + 1,
    offset,
  })
  const hasMore = hits.length > limit
  const page = hits.slice(0, limit)
  return {
    hits: page.map(hit => ({
      eventId: hit.eventId,
      conversationId: hit.conversationId,
      role: hit.role,
      createdAt: hit.createdAt,
      pos: hit.pos ?? 0,
      snippet: hit.snippet,
      address: hit.address,
    })),
    nextOffset: offset + page.length,
    hasMore,
  }
}

const projectPipeline = async (projectId: string): Promise<OptmemOverview['pipeline']> => {
  await explorerProject(projectId)
  if (!runtime) return undefined
  const persisted = runtime.pipelineOverview(projectId)
  if (!persisted) return undefined
  const status = await runtime.requireEngine().status()
  const stream = StreamIds.project(projectId)
  const work = status.queueByStream.find(item => item.stream === stream)
  const failures = status.failuresByStream.find(item => item.stream === stream)?.count ?? 0
  const paused = currentSettings().summarizerPaused
  const health = !currentSettings().enabled
    ? 'off'
    : paused
      ? 'paused'
      : failures > 0
        ? 'degraded'
        : (work?.running ?? 0) > 0
          ? 'processing'
          : persisted.pendingLeafJobs + persisted.pendingMergeJobs > 0 || (work?.leaves ?? 0) + (work?.parents ?? 0) > 0
            ? 'waiting'
            : 'idle'
  return { ...persisted, paused, health }
}

const panelApi = optmemApi.host({
  overview: () => overview(),
  providers: () => providers(),
  backfill: async ({ input }) => {
    if (!runtime) throw new Error('OptMem is not active in this DSH host.')
    const limit = Number.isSafeInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 500) : 20
    return { text: await runtime.backfill(limit) }
  },
  projects: () => explorerProjects(),
  projectForPath: async ({ input }) => {
    if (!runtime) return null
    return runtime.projectForPath(input.path)
  },
  projectView: async ({ input }) => explorerView(input.projectId),
  projectZoom: async ({ input }) => explorerZoom(input),
  projectSearch: async ({ input }) => explorerSearch(input),
  contextPreview: async ({ input }) => {
    await explorerProject(input.projectId)
    if (!runtime) throw new Error('OptMem is not active in this DSH host.')
    return runtime.contextPreview({ projectId: input.projectId, conversationId: input.conversationId })
  },
  projectPipeline: async ({ input }) => projectPipeline(input.projectId),
})

const setup = (ctx: Context): void => {
  hostContext = ctx
  const active = createOptmemRuntime({
    services: hostServices(ctx),
    databasePath: databasePath(),
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
      if (hostContext === ctx) hostContext = undefined
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
  apis: [panelApi],
  setup,
})
