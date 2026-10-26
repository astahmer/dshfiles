import { isAbsolute } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { BlockAssembler, ReasoningEffortId, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { createRouteResolver, type SummaryEffort } from '@dshfiles/optmem-core/summary-routes'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { createHostApiClient, defineHost, isApiServed } from '@dshfiles/dshx/host'
import { SecretReferenceResolver } from '@dshfiles/credential-port'
import type { SettingsScope } from '@dshfiles/dshx/settings'

import { z } from 'zod'

import { EmbeddingProviders, type MemoryEmbedder, type RetrievalStatus } from './embedder.ts'
import { costOfTokens } from '@dshfiles/ai-accounts/cost-estimate'
import { createPricingCatalog, DEFAULT_PRICING_PATH, resolveRouteQuote } from '@dshfiles/ai-accounts/pricing-catalog'
import { JEV_INPUT_USD_PER_MILLION, usageApi } from '@dshfiles/usage/api'

import { AgentScope } from './agent-scope.ts'
import { memoryApi, type MemoryCostLine, type MemoryCosts, type MemoryEvent, type MemoryUsage, type PanelNote, type PanelThread } from './api.ts'
import { memoryReferenceKey } from './memory-reference.ts'
import { projectPathFor } from './project-path.ts'
import { MemoryGuidance } from './guidance.ts'
import { ProjectScripts, type WorkspaceScripts } from './project-scripts.ts'
import { renderUsageSummary, snapshotOf } from './usage-summary.js'
import { workspaceScriptsApi } from './workspace-scripts-api.ts'
import { createMemoryRuntime, type Caller, type MemoryRuntime, type MemoryServices, type SessionTitleRead } from './runtime.ts'
import { MemorySessionList } from './session-list.ts'
import { memorySettings, type MemorySettings } from './settings.ts'
import { sessionContentHits } from './session-content.ts'
import { openMemoryStore, type MemoryStore, type NoteRecord, type StoredThread } from './store.ts'

let runtime: MemoryRuntime | undefined
let store: MemoryStore | undefined
let projectNormalization: Promise<void> = Promise.resolve()
let failure: string | null = null
let settingsScope: SettingsScope<MemorySettings> | undefined

const defaultSettings: MemorySettings = memorySettings.schema({})

const currentSettings = (): MemorySettings => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

const ownedSettings = memorySettings.host({
  setup: scope => {
    settingsScope = scope
    return () => {
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

const effortOf = (effort: string): SummaryEffort | undefined =>
  effort === 'off' || effort === 'low' || effort === 'medium' || effort === 'high' ? effort : undefined

const textOf = (blocks: readonly { readonly type: string; readonly text?: string }[]): string =>
  blocks.flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : [])).join('\n')

const embedders = new Map<string, Promise<MemoryEmbedder>>()

const listedTitleSchema = z.string().min(1)

/** A thread workspace's project scripts, or null outside a project with a lockfile or when they cannot be written. */
const workspaceScriptsFor = async (cwd: string | undefined): Promise<WorkspaceScripts | null> => {
  if (cwd === undefined) return null
  return ProjectScripts.ensure({ root: dshHomePath('plugins', 'memory', 'projects'), project: await projectPathFor(cwd) }).catch(() => null)
}

const TYPESAFE_ENV_KEY = 'TYPESAFE_API_KEY'

/** Session id → the memory scope it reads; a null answer is cached too, so a plain thread costs one lookup. */
const agentScopes = new Map<string, Promise<string | null>>()

/**
 * A subagent's parent: the live Agent registry first (no I/O), then its Session log, which is the only source once the
 * parent went cold. Cached with the scope, so a thread pays this at most once.
 */
const parentOf = async (ctx: Context, sessionId: string): Promise<string | undefined> => {
  const live = ctx
    .get('agents')
    ?.list()
    .find(agent => agent.id === sessionId)
  if (live !== undefined) return live.session.header.parentSession
  const log = await ctx
    .get('sessionQuery')
    ?.readSession(SessionId(sessionId))
    .catch(() => undefined)
  return log?.session.parentSession
}

const agentScopeOf = (ctx: Context, sessionId: string): Promise<string | null> => {
  const cached = agentScopes.get(sessionId)
  if (cached !== undefined) return cached
  const pending = (async () => {
    const { agentsApi } = await import('@dshfiles/agents/contract')
    if (!isApiServed(ctx, agentsApi, '@dshfiles/memory')) return null
    const client = createHostApiClient(ctx, agentsApi, '@dshfiles/memory')
    return AgentScope.resolve({
      sessionId,
      lookup: {
        threadAgent: async id => {
          const result = await client.safe.threadAgent({ sessionId: id })
          const agent = result.ok ? result.value.agent : null
          return agent === null ? null : { memoryScope: agent.memoryScope }
        },
        parentOf: id => parentOf(ctx, id),
      },
    })
  })().catch(() => null)
  agentScopes.set(sessionId, pending)
  return pending
}

const hostServices = (ctx: Context): MemoryServices => {
  const jevUsageClient = createHostApiClient(ctx, usageApi, '@dshfiles/memory')
  const sessionQuery = () => {
    const service = ctx.get('sessionQuery')
    if (!service) throw new Error('the DSH sessionQuery service is unavailable')
    return service
  }
  const sessionList = new MemorySessionList({
    listSessions: async () => (await sessionQuery().listSessions()).map(record => ({ header: record.header, live: record.live, persisted: record.persisted })),
  })
  ctx.on('session/created', () => sessionList.sessionsChanged())
  ctx.on('session/disposed', () => sessionList.sessionsChanged())
  const routes = createRouteResolver({
    policy: () => {
      const settings = currentSettings()
      return {
        override:
          settings.summarizerModel.length > 0
            ? { provider: settings.summarizerProvider, model: settings.summarizerModel, effort: effortOf(settings.summarizerEffort) }
            : undefined,
        cheapModels: settings.cheapModels.map(entry => ({ kind: entry.kind, models: entry.models, effort: effortOf(entry.effort) })),
        fallbacks: [],
      }
    },
    catalog: () => ({
      sessionProvider: async conversationId => {
        const log = await ctx
          .get('sessionQuery')
          ?.readSession(SessionId(conversationId))
          .catch(() => undefined)
        const header = log?.events.findLast(event => event.type === 'request/header')
        return header?.type === 'request/header' ? header.data.header.config.provider : undefined
      },
      // Cheap models match the provider id or its kind prefix (`opencode-go-pi` → `opencode-go`); AI Accounts' file is not read.
      providerKind: async () => undefined,
      models: async provider =>
        (
          (await ctx
            .get('llm')
            ?.listModels(provider)
            .catch(() => [])) ?? []
        ).map(model => model.id),
    }),
  })
  return {
    projectPath: async cwd => {
      await projectNormalization
      return projectPathFor(cwd)
    },
    agentMemoryScope: sessionId => agentScopeOf(ctx, sessionId),
    listSessions: () => sessionList.listSessions(),
    readSessionTitles: async sessionIds => {
      // The Session list serves each title from the projection cache (a log-prefix read, kept until the Session
      // changes). A Session it has no title for is left untitled here, so the finder falls back to its digest's title:
      // core's title fold decodes the whole log, 57 of them took 3.1 s of the first search after a restart.
      const listed = await ctx
        .get('sessionController')
        ?.list({}, AbortSignal.timeout(10_000))
        .catch(() => undefined)
      const fromList = new Map<string, SessionTitleRead>()
      for (const item of listed?.items ?? []) {
        const title = listedTitleSchema.safeParse(item.projections?.values.title)
        if (title.success) fromList.set(item.sessionId, { sessionId: item.sessionId, title: title.data, updatedAt: item.updatedAt })
      }
      return sessionIds.map(id => fromList.get(id) ?? { sessionId: id, title: undefined, updatedAt: undefined })
    },
    searchSessionContent: async (request, signal) => {
      const page = await sessionQuery().searchSessions(
        {
          query: request.query,
          eventFilters: [
            { kind: 'type', values: ['user/message', 'assistant/message'] },
            { kind: 'surface', values: ['current'] },
          ],
          limit: request.limit,
        },
        signal === undefined ? undefined : { signal },
      )
      return sessionContentHits(page)
    },
    readSession: async sessionId => {
      const log = await sessionQuery().readSession(SessionId(sessionId))
      return { header: log.session, inheritedEventCount: log.inheritedEventCount, events: log.events }
    },
    summarize: async request => {
      const llm = ctx.get('llm')
      if (!llm) throw new Error('the DSH llm service is unavailable')
      const state = await routes.resolve(request.conversationId)
      if (state.kind !== 'ready') throw new Error(state.kind === 'unavailable' ? state.reason : 'no route resolved')
      let effort = state.route.effort
      for (let attempt = 0; attempt < 2; attempt++) {
        const base: Omit<GenerateOptions, 'reasoningEffort'> = {
          provider: state.route.provider,
          model: state.route.model,
          system: request.system,
          messages: [createUserMessage({ content: [{ type: 'text', text: request.input }], source: { kind: 'user' } })],
          maxTokens: 2_048,
          purpose: 'compaction',
          signal: AbortSignal.timeout(60_000),
          // OpenCode Go rejects calls without the per-conversation header the loop normally stamps; digests always name a session.
          sessionId: SessionId(request.conversationId),
        }
        const assembler = new BlockAssembler()
        for await (const chunk of llm.stream(effort === undefined ? base : { ...base, reasoningEffort: ReasoningEffortId(effort) })) assembler.push(chunk)
        const finish = assembler.finish
        if (finish.kind === 'error' && finish.failure.code === 'UNSUPPORTED_REASONING_EFFORT' && effort !== undefined) {
          effort = undefined
          continue
        }
        if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure.message)
        const text = assembler
          .blocks()
          .flatMap(block => (block.type === 'text' ? [block.text] : []))
          .join('')
          .trim()
        if (text.length === 0) throw new Error(`the digest model returned no text (${finish.kind})`)
        const tokens = assembler.usage
        return {
          text,
          usage:
            tokens === undefined
              ? undefined
              : {
                  provider: state.route.provider,
                  model: state.route.model,
                  input: tokens.inputTokens,
                  cacheRead: tokens.cacheReadTokens ?? 0,
                  output: tokens.outputTokens,
                },
        }
      }
      throw new Error('the digest route rejected every reasoning effort')
    },
    embedder: specifier => {
      const loaded = embedders.get(specifier) ?? EmbeddingProviders.load(specifier)
      embedders.set(specifier, loaded)
      // A provider that failed to load is retried on the next search instead of staying broken until restart.
      loaded.catch(() => embedders.delete(specifier))
      return loaded
    },
    jevCredential: async () =>
      SecretReferenceResolver.resolveWithLabel({
        referenceText: currentSettings().jevSecret,
        values: ctx.get('secretCatalogValues'),
        environmentValue: process.env[TYPESAFE_ENV_KEY],
        environmentVariableName: TYPESAFE_ENV_KEY,
      }),
    recordJevUsage: async record => {
      await jevUsageClient.safe.recordJevUsage(record)
    },
  }
}

const bm25Only: RetrievalStatus = { requested: 'bm25', active: 'bm25', model: null, reason: null }

const pricing = createPricingCatalog({ path: DEFAULT_PRICING_PATH })
let pricingLoaded: Promise<void> | undefined

/** List-price dollars of one digest route's tokens from AI Accounts' models.dev cache, or null when the route is unpriced. */
const digestUsd = async (line: {
  readonly provider: string
  readonly model: string
  readonly input: number
  readonly cacheRead: number
  readonly output: number
}) => {
  pricingLoaded ??= pricing.load().catch(() => undefined)
  await pricingLoaded
  const price = resolveRouteQuote({ route: { provider: line.provider, model: line.model }, cache: pricing.current(), overrides: {} }).price
  if (price === null) return null
  return costOfTokens({
    tokens: { uncachedInputTokens: line.input, cacheReadTokens: line.cacheRead, outputTokens: line.output, cacheWriteTokens: 0 },
    price,
    band: 0,
  }).total
}

const emptyCostLine = (): MemoryCostLine => ({ digest: { calls: 0, input: 0, cacheRead: 0, output: 0, usd: 0 }, jev: { calls: 0, input: 0, usd: 0 } })

const addCost = (line: MemoryCostLine, row: ReturnType<MemoryStore['costsByDay']>[number], usd: number | null): MemoryCostLine =>
  row.kind === 'jev'
    ? {
        ...line,
        jev: { calls: line.jev.calls + row.calls, input: line.jev.input + row.input, usd: line.jev.usd + (row.input * JEV_INPUT_USD_PER_MILLION) / 1e6 },
      }
    : {
        ...line,
        digest: {
          calls: line.digest.calls + row.calls,
          input: line.digest.input + row.input,
          cacheRead: line.digest.cacheRead + row.cacheRead,
          output: line.digest.output + row.output,
          usd: line.digest.usd === null || usd === null ? null : line.digest.usd + usd,
        },
      }

const costs = async (opened: MemoryStore, days: number): Promise<MemoryCosts> => {
  const byDay = new Map<string, MemoryCostLine>()
  let total = emptyCostLine()
  for (const row of opened.costsByDay(days)) {
    const usd = row.kind === 'digest' ? await digestUsd(row) : 0
    byDay.set(row.day, addCost(byDay.get(row.day) ?? emptyCostLine(), row, usd))
    total = addCost(total, row, usd)
  }
  return { days: [...byDay].map(([day, line]) => ({ day, ...line })), total }
}

/** Recent citations, digests and note writes, newest first, for the analytics activity list. */
const recentEvents = (opened: MemoryStore, limit: number): readonly MemoryEvent[] => {
  const threads = opened.listThreads({ limit })
  const titles = new Map(threads.map(thread => [thread.id, thread.title]))
  const events: MemoryEvent[] = []
  for (const note of opened.listNotes({ limit })) {
    events.push({
      at: note.createdAt,
      kind: 'note',
      project: note.project,
      detail: note.text,
      thread: note.sourceThread,
      threadTitle: note.sourceThread === null ? null : (titles.get(note.sourceThread) ?? null),
      noteId: note.id,
      ref: `n:${note.id}`,
      rating: null,
      agentCorrected: false,
      userCorrected: false,
    })
  }
  for (const thread of threads) {
    events.push({
      at: thread.digestedAt,
      kind: 'digest',
      project: thread.project,
      detail: thread.title,
      thread: thread.id,
      threadTitle: thread.title,
      noteId: null,
      ref: `t:${thread.id}`,
      rating: null,
      agentCorrected: false,
      userCorrected: false,
    })
  }
  for (const citation of opened.recentCitations({ limit })) {
    events.push({
      at: citation.at,
      kind: 'citation',
      project: citation.project ?? 'unknown',
      detail: citation.target ?? citation.ref,
      thread: citation.thread,
      threadTitle: citation.threadTitle,
      noteId: null,
      ref: citation.ref,
      rating: citation.rating,
      agentCorrected: citation.agentCorrected,
      userCorrected: citation.userCorrected,
    })
  }
  return events.sort((left, right) => right.at - left.at).slice(0, limit)
}

const usage = async (days: number): Promise<MemoryUsage> => {
  const base = {
    state: currentSettings().enabled ? (failure === null ? 'ready' : 'failed') : 'off',
    failure,
    retrieval: runtime === undefined ? bm25Only : await runtime.retrievalStatus(),
  } as const
  if (!store)
    return {
      ...base,
      state: failure === null ? 'off' : 'failed',
      threads: 0,
      notes: 0,
      indexedMessages: 0,
      blocksServed: 0,
      citations: 0,
      digests: { trail: 0, model: 0, duplicate: 0, trivial: 0, modelFailures: 0 },
      jev: { calls: 0, inputTokens: 0, failures: 0 },
      tools: [],
      costs: { days: [], total: emptyCostLine() },
      effectiveness: {
        block: { threads: 0, meanBytes: 0, maxBytes: 0, requests: 0 },
        citations: { total: 0, agentCorrected: 0, userCorrected: 0, up: 0, down: 0 },
      },
      noteCounts: { active: 0, superseded: 0, forgotten: 0, archived: 0 },
      daily: [],
      events: [],
      topNotes: [],
    }
  const counts = store.usage()
  const counter = (name: string): number => counts.counters[name] ?? 0
  return {
    ...base,
    threads: counts.threads,
    notes: counts.notes,
    indexedMessages: counts.indexedMessages,
    blocksServed: counter('blocks.served'),
    citations: counter('citations'),
    digests: {
      trail: counter('digests.trail'),
      model: counter('digests.model'),
      duplicate: counter('digests.duplicate'),
      trivial: counter('digests.skippedTrivial'),
      modelFailures: counter('digests.modelFailures'),
    },
    jev: { calls: counter('jev.calls'), inputTokens: counter('jev.inputTokens'), failures: counter('jev.failures') },
    tools: counts.tools,
    costs: await costs(store, days),
    effectiveness: store.effectiveness(),
    noteCounts: store.noteStatusCounts(),
    daily: store.usageByDay(days),
    events: recentEvents(store, 40),
    topNotes: store.topNotes(8).map(panelNote),
  }
}

const requireStore = (): MemoryStore => {
  if (!store) throw new Error(failure === null ? 'Memory is not active in this DSH host.' : `Memory failed to start: ${failure}`)
  return store
}

const panelStatusOf = (note: NoteRecord): PanelNote['status'] => {
  if (note.archivedAt !== null) return 'archived'
  if (note.valid) return 'valid'
  if (note.forgottenAt !== null) return 'forgotten'
  return 'superseded'
}

const panelNote = (note: NoteRecord): PanelNote => ({
  id: note.id,
  project: note.project,
  type: note.category,
  scope: note.scope,
  confidence: note.confidence,
  text: note.text,
  sourceThread: note.sourceThread,
  sourceSeq: note.sourceSeq,
  origin: note.origin,
  createdAt: note.firstCreatedAt,
  updatedAt: note.createdAt,
  citations: note.uses,
  status: panelStatusOf(note),
  archivedAt: note.archivedAt,
  supersedes: note.supersedes,
  supersededBy: note.supersededBy,
  reason: note.reason,
})

const panelThread = (thread: StoredThread): PanelThread => ({
  id: thread.id,
  project: thread.project,
  title: thread.title,
  decision: thread.decision,
  digest: thread.digest,
  source: thread.source,
  updatedAt: thread.updatedAt,
  createdAt: thread.updatedAt,
  digestedAt: thread.digestedAt,
  digested: true,
  events: thread.lastSeq + 1,
  lastSeq: thread.lastSeq,
  citations: thread.uses,
})

const noteType = z.enum(['user', 'feedback', 'project', 'reference'])
/** The panel sends every filter field; an empty string means "any". */
const anyWhenEmpty = (max: number) =>
  z
    .string()
    .max(max)
    .transform(value => (value.trim() === '' ? undefined : value))
const notesFilter = z.object({
  project: anyWhenEmpty(4_096),
  scope: anyWhenEmpty(256),
  type: z.union([noteType, z.literal('').transform(() => undefined)]),
  query: anyWhenEmpty(256),
  thread: anyWhenEmpty(200),
  includeInvalid: z.boolean(),
})
const noteId = z.number().int().positive()
const reason = z.string().trim().max(500).optional()

/** The calling thread for memory's agent tools; a Client or plugin caller searches as no particular thread. */
const callerOf = (caller: ApiCaller): Caller => {
  if (caller.kind === 'agent' && caller.sessionId !== undefined) return { id: caller.sessionId, session: { header: { id: caller.sessionId, cwd: caller.cwd } } }
  const id = caller.kind === 'plugin' ? `api:${caller.packageId}` : 'api:client'
  return { id, session: { header: { id } } }
}

const withRuntime = async (body: (active: MemoryRuntime) => Promise<string>): Promise<{ readonly summary: string }> => {
  if (!runtime) throw new Error('Memory is not active in this DSH host (setting dshfiles-memory.enabled, or the plugin failed to start).')
  await projectNormalization
  return { summary: await body(runtime) }
}

/** Same activation gate as withRuntime, for capabilities that return structured data instead of a summary. */
const withMemory = async <Result>(body: (active: MemoryRuntime) => Promise<Result>): Promise<Result> => {
  if (!runtime) throw new Error('Memory is not active in this DSH host (setting dshfiles-memory.enabled, or the plugin failed to start).')
  await projectNormalization
  return body(runtime)
}

const dayMs = 86_400_000

/** `YYYY-MM-DD` (a whole UTC day) or an ISO 8601 timestamp; anything else is refused rather than silently ignored. */
const instant = (value: string | undefined, endOfDay: boolean): number | undefined => {
  if (value === undefined || value.trim().length === 0) return undefined
  const text = value.trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text)
  const parsed = dateOnly ? Date.parse(`${text}T00:00:00.000Z`) : Date.parse(text)
  if (!Number.isFinite(parsed)) throw new Error(`${JSON.stringify(value)} is not a date: use YYYY-MM-DD or an ISO 8601 timestamp.`)
  return dateOnly && endOfDay ? parsed + dayMs - 1 : parsed
}

const workspaceScriptsHost = workspaceScriptsApi.host({
  scripts: async ({ input }) => workspaceScriptsFor(input.cwd),
})

const panelApi = memoryApi.host({
  search: ({ input, caller }) => withRuntime(active => active.search(callerOf(caller), input)),
  findThreads: ({ input, caller }) =>
    withMemory(active =>
      active.findThreads(callerOf(caller), {
        ...input,
        createdFrom: instant(input.createdFrom, false),
        createdTo: instant(input.createdTo, true),
      }),
    ),
  relatedThreads: ({ input, caller }) => withMemory(active => active.relatedThreads(callerOf(caller), input)),
  read: ({ input, caller }) => withRuntime(active => active.read(callerOf(caller), input)),
  preview: ({ input }) =>
    withMemory(async active => {
      const summary = await active.preview(input)
      const key = memoryReferenceKey(input)
      const store = key === null || key.kind === 'excerpt' ? undefined : requireStore()
      if (key?.kind === 'note' && store !== undefined) {
        const note = store.noteHistory(key.noteId).find(record => record.valid && record.id === key.noteId)
        if (note === undefined) return { kind: 'missing' as const, id: input.id, summary, note: null, thread: null }
        return { kind: 'note' as const, id: input.id, summary, note: panelNote(note), thread: null }
      }
      if (key?.kind === 'digest' && store !== undefined) {
        const thread = store.thread(key.threadKey)
        if (thread === undefined) return { kind: 'missing' as const, id: input.id, summary, note: null, thread: null }
        return { kind: 'digest' as const, id: input.id, summary, note: null, thread: panelThread(thread) }
      }
      if (key?.kind === 'excerpt') return { kind: 'excerpt' as const, id: input.id, summary, note: null, thread: null }
      return { kind: 'missing' as const, id: input.id, summary, note: null, thread: null }
    }),
  note: ({ input, caller }) => withRuntime(active => active.note(callerOf(caller), input)),
  usage: ({ input }) => usage(input.days ?? 30),
  usageSummary: async ({ input }) => {
    const days = input.days ?? 30
    return { summary: renderUsageSummary(snapshotOf(await usage(days), days)) }
  },
  projects: async () => {
    await projectNormalization
    return [...requireStore().projects()]
  },
  startBlock: ({ input }) => {
    if (!runtime) throw new Error('Memory is not active in this DSH host (setting dshfiles-memory.enabled, or the plugin failed to start).')
    return runtime.previewStartBlock(input.cwd, input.scope)
  },
  notes: async ({ input }) => {
    await projectNormalization
    const filter = notesFilter.parse(input)
    const notes = requireStore()
      .listNotes({
        project: filter.project,
        scope: filter.scope,
        category: filter.type,
        query: filter.query,
        thread: filter.thread,
        includeInvalid: filter.includeInvalid,
        limit: 500,
      })
      .map(panelNote)
    return [...notes]
  },
  panelNotes: async ({ input }) => {
    await projectNormalization
    const filter = notesFilter.parse(input)
    return requireStore()
      .listNotes({
        project: filter.project,
        scope: filter.scope,
        category: filter.type,
        query: filter.query,
        thread: filter.thread,
        includeInvalid: filter.includeInvalid,
        includeArchived: true,
        limit: 500,
      })
      .map(panelNote)
  },
  reviewNotes: ({ input, caller }) =>
    withMemory(active =>
      active.reviewNotes(callerOf(caller), {
        project: anyWhenEmpty(4_096).parse(input.project),
        afterId: input.afterId,
        limit: input.limit,
      }),
    ),
  noteCounts: async ({ input }) => {
    await projectNormalization
    return requireStore().noteStatusCounts(anyWhenEmpty(4_096).parse(input.project))
  },
  createNote: async ({ input }) => {
    await projectNormalization
    const parsed = z
      .object({
        project: z.string().min(1).max(4_096),
        text: z.string().trim().min(1).max(2_000),
        type: noteType,
        scope: z.string().trim().min(1).max(256),
        confidence: z.enum(['stated', 'inferred']),
      })
      .strict()
      .parse(input)
    const saved = requireStore().addNote({
      project: parsed.project,
      text: parsed.text,
      category: parsed.type,
      scope: parsed.scope,
      confidence: parsed.confidence,
      sourceThread: null,
      sourceSeq: null,
      origin: 'panel',
    })
    void runtime?.embedMissing()
    const record = requireStore()
      .noteHistory(saved.note.id)
      .find(note => note.id === saved.note.id)
    if (!record) throw new Error('The new note could not be read back.')
    return panelNote(record)
  },
  noteHistory: ({ input }) => [
    ...requireStore()
      .noteHistory(noteId.parse(input.id))
      .filter(note => note.archivedAt === null)
      .map(panelNote),
  ],
  panelNoteHistory: ({ input }) => [...requireStore().noteHistory(noteId.parse(input.id)).map(panelNote)],
  editNote: ({ input }) => {
    const parsed = z
      .object({ id: noteId, text: z.string().trim().min(1).max(2_000), type: noteType.optional(), scope: z.string().trim().min(1).max(256).optional(), reason })
      .parse(input)
    const updated = requireStore().updateNote({
      id: parsed.id,
      text: parsed.text,
      category: parsed.type,
      scope: parsed.scope,
      reason: parsed.reason || 'edited in the Memory panel',
      sourceThread: null,
      sourceSeq: null,
      origin: 'panel',
    })
    if (!updated) throw new Error(`Note n:${parsed.id} is no longer valid; refresh the list.`)
    const record = requireStore()
      .noteHistory(updated.id)
      .find(note => note.id === updated.id)
    if (!record) throw new Error('The updated note could not be read back.')
    return panelNote(record)
  },
  forgetNote: ({ input }) => {
    const parsed = z.object({ id: noteId, reason }).parse(input)
    return { forgotten: requireStore().forgetNote({ id: parsed.id, reason: parsed.reason || 'removed in the Memory panel' }) }
  },
  archiveNote: ({ input }) => ({ archived: requireStore().archiveNote(noteId.parse(input.id)) }),
  restoreNote: ({ input }) => ({ restored: requireStore().restoreNote(noteId.parse(input.id)) }),
  citations: ({ input }) => [
    ...requireStore().recentCitations({
      limit: 100,
      thread: input.thread === undefined || input.thread.length === 0 ? undefined : input.thread,
      ref: input.ref === undefined || input.ref.length === 0 ? undefined : input.ref,
    }),
  ],
  rateCitation: ({ input }) => {
    const parsed = z.object({ id: noteId, rating: z.enum(['up', 'down']).nullable() }).parse(input)
    return { rated: requireStore().rateCitation(parsed) }
  },
  threads: async ({ input }) => {
    await projectNormalization
    const project = anyWhenEmpty(4_096).parse(input.project)
    const stored = requireStore().listThreads({ project, limit: 500 }).map(panelThread)
    if (input.includeUndigested !== true) return [...stored]
    const digested = new Set(stored.map(thread => thread.id))
    const records = await withMemory(active => active.listThreadRecords())
    const sessions: PanelThread[] = records
      .filter(record => !digested.has(record.sessionId))
      .filter(record => project === undefined || record.project === project)
      .map(record => ({
        id: record.sessionId,
        project: record.project,
        title: record.title.length === 0 ? '(untitled thread)' : record.title,
        decision: '',
        digest: '',
        source: null,
        updatedAt: record.updatedAt,
        createdAt: record.createdAt,
        digestedAt: null,
        digested: false,
        events: null,
        lastSeq: 0,
        citations: 0,
      }))
    return [...stored, ...sessions].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 500)
  },
  threadDetail: ({ input }) => withMemory(active => active.threadDetail(input.id)),
  redigest: ({ input }) => withRuntime(active => active.digest(input.id)).then(result => ({ outcome: result.summary })),
})

const normalizeProjectPaths = async (opened: MemoryStore) => {
  const mappings: { from: string; to: string }[] = []
  for (const from of opened.projectPaths()) {
    if (!isAbsolute(from)) continue
    const to = await projectPathFor(from)
    if (to !== from) mappings.push({ from, to })
  }
  const result = opened.rekeyProjects({ mappings })
  return {
    projects: result.projects,
    notes: result.moved.notes,
    threads: result.moved.threads,
    messages: result.moved.messages,
    conflicts: result.conflicts.length,
  }
}

const setup = (ctx: Context): void => {
  const logger = ctx.logger('memory')
  let opened: MemoryStore
  try {
    opened = openMemoryStore({ path: dshHomePath('plugins', 'memory', 'memory.db') })
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    logger.warn('memory: the store could not be opened; memory is off: %s', failure)
    return
  }
  store = opened
  failure = null
  const normalization = normalizeProjectPaths(opened)
    .then(result => {
      if (result.projects > 0)
        logger.info(
          'memory: normalized %d JJ workspace path(s): %d digest(s), %d note(s), %d indexed message(s)',
          result.projects,
          result.threads,
          result.notes,
          result.messages,
        )
      if (result.conflicts > 0) logger.warn('memory: left %d JJ workspace path(s) separate due to duplicate note or digest hashes', result.conflicts)
    })
    .catch(() => logger.warn('memory: JJ workspace memory backfill failed; remaining entries stay separate'))
  projectNormalization = normalization
  const active = createMemoryRuntime({ services: hostServices(ctx), store: opened, settings: currentSettings, logger })
  runtime = active

  ctx.on('session/event', (session, event) => active.onSessionEvent(session, event))

  // The block is appended to the system prompt at the first assembly of each agent (subagents included) and frozen
  // there, so it sits in the stable prefix and is never re-emitted mid-thread.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (!agent) return assembled
    try {
      const text = await active.startBlock(agent, async () => {
        const log = await ctx.get('sessionQuery')?.readSession(agent.session.id)
        const first = log?.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
        return first?.type === 'user/message' ? textOf(first.data.content) : undefined
      })
      const scripts = await workspaceScriptsFor(agent.session.header.cwd)
      const sections = [
        ...(text.length === 0 ? [] : [{ name: 'dshfiles-memory:start-block', text, interpolate: false }]),
        ...(scripts === null ? [] : [{ name: 'dshfiles-memory:workspace-scripts', text: MemoryGuidance.workspaceScripts(scripts), interpolate: false }]),
      ]
      if (sections.length === 0) return assembled
      active.countBlockRequest(Buffer.byteLength(text))
      return { ...assembled, sections: [...assembled.sections, ...sections] }
    } catch (error) {
      logger.warn('memory: no start block for %s: %s', agent.id, error instanceof Error ? error.message : String(error))
      return assembled
    }
  })

  ctx.effect(() => {
    const maintain = (): void => {
      try {
        const pruned = opened.prune(currentSettings().retentionDays)
        if (pruned.threads + pruned.messages > 0)
          logger.info('memory: retention dropped %d digest(s) and %d indexed message(s)', pruned.threads, pruned.messages)
      } catch (error) {
        logger.warn('memory: retention pass failed: %s', error instanceof Error ? error.message : String(error))
      }
    }
    // Catch-up waits for boot to settle, then digests a bounded batch of sessions never seen before.
    const catchUp = setTimeout(() => {
      maintain()
      void active
        .catchUp(25)
        .then(count => count > 0 && logger.info('memory: caught up %d earlier session(s)', count))
        .catch((error: unknown) => logger.warn('memory: catch-up failed: %s', error instanceof Error ? error.message : String(error)))
    }, 30_000)
    const daily = setInterval(maintain, dayMs)
    return () => {
      clearTimeout(catchUp)
      clearInterval(daily)
      active.stop()
      if (runtime === active) runtime = undefined
      if (store === opened) store = undefined
      if (projectNormalization === normalization) projectNormalization = Promise.resolve()
      void normalization
        .finally(() => opened.close())
        .catch((error: unknown) => logger.warn('memory: closing the store failed: %s', error instanceof Error ? error.message : String(error)))
    }
  }, 'memory runtime')
}

export default defineHost({
  name: '@dshfiles/memory',
  settings: [ownedSettings],
  apis: [panelApi, workspaceScriptsHost],
  setup,
})
