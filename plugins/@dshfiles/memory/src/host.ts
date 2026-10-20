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
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'

import { z } from 'zod'

import { EmbeddingProviders, type MemoryEmbedder, type RetrievalStatus } from './embedder.ts'
import { costOfTokens } from '@dshfiles/ai-accounts/cost-estimate'
import { createPricingCatalog, DEFAULT_PRICING_PATH, resolveRouteQuote } from '@dshfiles/ai-accounts/pricing-catalog'

import { memoryApi, type MemoryCostLine, type MemoryCosts, type MemoryUsage, type PanelNote, type PanelThread } from './api.ts'
import { projectPathFor } from './project-path.ts'
import { MemoryGuidance } from './guidance.ts'
import { ProjectScripts, type WorkspaceScripts } from './project-scripts.ts'
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

const hostServices = (ctx: Context): MemoryServices => {
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
    jevKey: () => {
      const key = process.env['TYPESAFE_API_KEY']
      return key === undefined || key.length === 0 ? undefined : key
    },
  }
}

const bm25Only: RetrievalStatus = { requested: 'bm25', active: 'bm25', model: null, reason: null }

/** TypeSafe's list price for Jev input; its output is free. */
const jevUsdPerMillionInput = 0.042

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
    ? { ...line, jev: { calls: line.jev.calls + row.calls, input: line.jev.input + row.input, usd: line.jev.usd + (row.input * jevUsdPerMillionInput) / 1e6 } }
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

const costs = async (opened: MemoryStore): Promise<MemoryCosts> => {
  const days = new Map<string, MemoryCostLine>()
  let total = emptyCostLine()
  for (const row of opened.costsByDay(30)) {
    const usd = row.kind === 'digest' ? await digestUsd(row) : 0
    days.set(row.day, addCost(days.get(row.day) ?? emptyCostLine(), row, usd))
    total = addCost(total, row, usd)
  }
  return { days: [...days].map(([day, line]) => ({ day, ...line })), total }
}

const usage = async (): Promise<MemoryUsage> => {
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
      daily: [],
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
    costs: await costs(store),
    effectiveness: store.effectiveness(),
    daily: store.usageByDay(30),
  }
}

const requireStore = (): MemoryStore => {
  if (!store) throw new Error(failure === null ? 'Memory is not active in this DSH host.' : `Memory failed to start: ${failure}`)
  return store
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
  status: note.valid ? 'valid' : note.forgottenAt !== null ? 'forgotten' : 'superseded',
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
  digestedAt: thread.digestedAt,
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
  preview: ({ input }) => withRuntime(active => active.preview(input)),
  note: ({ input, caller }) => withRuntime(active => active.note(callerOf(caller), input)),
  usage: () => usage(),
  projects: async () => {
    await projectNormalization
    return [...requireStore().projects()]
  },
  startBlock: ({ input }) => {
    if (!runtime) throw new Error('Memory is not active in this DSH host (setting dshfiles-memory.enabled, or the plugin failed to start).')
    return runtime.previewStartBlock(input.cwd)
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
        includeInvalid: filter.includeInvalid,
        limit: 500,
      })
      .map(panelNote)
    return [...notes]
  },
  noteHistory: ({ input }) => [...requireStore().noteHistory(noteId.parse(input.id)).map(panelNote)],
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
  citations: () => [...requireStore().recentCitations(100)],
  rateCitation: ({ input }) => {
    const parsed = z.object({ id: noteId, rating: z.enum(['up', 'down']).nullable() }).parse(input)
    return { rated: requireStore().rateCitation(parsed) }
  },
  threads: async ({ input }) => {
    await projectNormalization
    const project = anyWhenEmpty(4_096).parse(input.project)
    return [...requireStore().listThreads({ project, limit: 300 }).map(panelThread)]
  },
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
      void active.catchUp(25).then(count => count > 0 && logger.info('memory: caught up %d earlier session(s)', count))
    }, 30_000)
    const daily = setInterval(maintain, dayMs)
    return () => {
      clearTimeout(catchUp)
      clearInterval(daily)
      active.stop()
      if (runtime === active) runtime = undefined
      if (store === opened) store = undefined
      if (projectNormalization === normalization) projectNormalization = Promise.resolve()
      void normalization.finally(() => opened.close())
    }
  }, 'memory runtime')
}

export default defineHost({
  name: '@dshfiles/memory',
  settings: [ownedSettings],
  apis: [panelApi, workspaceScriptsHost],
  setup,
})
