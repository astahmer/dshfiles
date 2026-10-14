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
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'

import { z } from 'zod'

import { EmbeddingProviders, type MemoryEmbedder, type RetrievalStatus } from './embedder.ts'
import { memoryApi, type MemoryUsage, type PanelNote, type PanelThread } from './api.ts'
import { createMemoryRuntime, type MemoryRuntime, type MemoryServices } from './runtime.ts'
import { memorySettings, type MemorySettings } from './settings.ts'
import { openMemoryStore, type MemoryStore, type NoteRecord, type StoredThread } from './store.ts'
import { createMemoryTools } from './tools.ts'

let runtime: MemoryRuntime | undefined
let store: MemoryStore | undefined
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

const hostServices = (ctx: Context): MemoryServices => {
  const sessionQuery = () => {
    const service = ctx.get('sessionQuery')
    if (!service) throw new Error('the DSH sessionQuery service is unavailable')
    return service
  }
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
    listSessions: async () => (await sessionQuery().listSessions()).map(record => ({ header: record.header, live: record.live })),
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
        return { text }
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

const panelApi = memoryApi.host({
  usage: () => usage(),
  projects: () => requireStore().projects(),
  notes: ({ input }) => {
    const filter = notesFilter.parse(input)
    return requireStore()
      .listNotes({
        project: filter.project,
        scope: filter.scope,
        category: filter.type,
        query: filter.query,
        includeInvalid: filter.includeInvalid,
        limit: 500,
      })
      .map(panelNote)
  },
  noteHistory: ({ input }) => requireStore().noteHistory(noteId.parse(input.id)).map(panelNote),
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
  threads: ({ input }) => {
    const project = anyWhenEmpty(4_096).parse(input.project)
    return requireStore().listThreads({ project, limit: 300 }).map(panelThread)
  },
})

const dayMs = 86_400_000

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
      if (text.length === 0) return assembled
      return { ...assembled, sections: [...assembled.sections, { name: 'dshfiles-memory:start-block', text, interpolate: false }] }
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
      opened.close()
    }
  }, 'memory runtime')
}

export default defineHost({
  name: '@dshfiles/memory',
  tools: createMemoryTools(() => runtime),
  settings: [ownedSettings],
  apis: [panelApi],
  setup,
})
