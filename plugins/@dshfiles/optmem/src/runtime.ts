import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  Capabilities,
  StreamIds,
  createMemoryEngine,
  type CapabilityCheck,
  type HarnessCapabilities,
  type MemoryAccess,
  type MemoryConfig,
  type MemoryEngine,
  type MemoryEventInput,
  type StreamId,
  type Summarizer,
} from '@dshfiles/optmem-core'
import { openSqliteMemory, type SqliteMemory } from '@dshfiles/optmem-sqlite'

import { createCapture, type CaptureHeader, type CapturePolicy, type CaptureSession } from './capture.ts'
import { createInjectionCache } from './injection.ts'
import type { OptmemSettings } from './settings.ts'
import type { SummarizerRouteState } from './summarizer.ts'

export type RuntimeState = 'off' | 'starting' | 'ready' | 'failed'

type Logger = { warn(message: string, ...args: unknown[]): void; info(message: string, ...args: unknown[]): void }

type Ready = { readonly memory: SqliteMemory; readonly engine: MemoryEngine }

type Pending = { readonly session: CaptureSession; readonly event: SessionEvent }

type BackfillProgress = { readonly sessions: Record<string, number> }

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const engineKeys = [
  'injectUpperBytes',
  'injectLowerBytes',
  'viewUpperBytes',
  'viewLowerBytes',
  'maxNodeBytes',
  'summarizerConcurrency',
  'summarizerTimeoutMs',
  'barrierMs',
  'toolResultCap',
] as const

const engineConfig = (settings: OptmemSettings): Partial<MemoryConfig> => ({
  maxNodeBytes: settings.maxNodeBytes,
  viewUpperBytes: settings.viewUpperBytes,
  viewLowerBytes: Math.min(settings.viewLowerBytes, settings.viewUpperBytes),
  compactUpperBytes: settings.injectUpperBytes,
  compactLowerBytes: Math.min(settings.injectLowerBytes, settings.injectUpperBytes),
  concurrency: settings.summarizerConcurrency,
  summaryTimeoutMs: settings.summarizerTimeoutMs,
  barrierMs: settings.barrierMs,
  toolResultMaxBytes: settings.toolResultCap,
})

export type SessionLogSource = {
  listSessions(): Promise<readonly { readonly header: CaptureHeader }[]>
  readSession(sessionId: string): Promise<{ readonly session: CaptureHeader; readonly inheritedEventCount: number; readonly events: readonly SessionEvent[] }>
}

/** The DSH services OptMem uses, each optional at runtime; the Host adapts them from its Cordis context. */
export type HostServices = {
  has(service: 'sessions' | 'tools' | 'systemPrompt'): boolean
  workspaceId(path: string): Promise<string | undefined>
  sessionLogs(): SessionLogSource | undefined
  createSummarizer(): Summarizer
  summarizerRoute(): SummarizerRouteState
}

export type OptmemRuntimeOptions = {
  readonly services: HostServices
  readonly databasePath: string
  readonly settings: () => OptmemSettings
  readonly settingsSource?: (() => 'entry' | 'defaults') | undefined
  readonly logger: Logger
}

/**
 * Everything OptMem does inside DSH. Every entry point catches its own failures: a broken store or summarizer degrades
 * memory, never the DSH session that triggered it.
 */
export const createOptmemRuntime = (options: OptmemRuntimeOptions) => {
  const { services, logger } = options
  const capture = createCapture()
  const injection = createInjectionCache()
  const projects = new Map<string, string | null>()
  const resolving = new Map<string, Promise<string | null>>()
  const injectedStreams = new Set<StreamId>()
  const refreshing = new Map<StreamId, boolean>()
  let state: RuntimeState = 'off'
  let ready: Ready | undefined
  let failure: string | null = null
  let lastCaptureError: string | null = null
  let captured = 0
  let skipped = 0
  let queue: Pending[] = []
  let flushing: Promise<void> = Promise.resolve()
  let flushScheduled = false
  let appliedSettings = options.settings()

  const capabilities = (): HarnessCapabilities => ({
    captureEvents: services.has('sessions'),
    registerTools: services.has('tools'),
    injectContext: services.has('systemPrompt'),
    replaceContext: false,
    resetPerTurn: false,
  })

  const modeCheck = (): CapabilityCheck => Capabilities.validate(options.settings().mode === 'full' ? 'full' : 'compatibility', capabilities())

  const policy = (): CapturePolicy => {
    const settings = options.settings()
    return { excludedTools: settings.excludedTools, excludedPaths: settings.excludedPaths, captureSubagents: settings.captureSubagents }
  }


  const resolveProject = (header: CaptureHeader): Promise<string | null> => {
    const known = projects.get(header.id)
    if (known !== undefined) return Promise.resolve(known)
    const inflight = resolving.get(header.id)
    if (inflight) return inflight
    const pending = (async (): Promise<string | null> => {
      const cwd = header.cwd
      if (cwd === undefined || cwd.length === 0) return null
      const real = await realpath(cwd).catch(() => resolve(cwd))
      const workspaceId = await services.workspaceId(real).catch(() => undefined)
      if (workspaceId !== undefined) return `workspace:${workspaceId}`
      return `path:${createHash('sha256').update(real).digest('hex').slice(0, 16)}`
    })()
      .catch((error: unknown) => {
        logger.warn('optmem: project resolution failed for %s: %s', header.id, errorMessage(error))
        return null
      })
      .then(projectId => {
        projects.set(header.id, projectId)
        resolving.delete(header.id)
        return projectId
      })
    resolving.set(header.id, pending)
    return pending
  }

  const refreshStream = (stream: StreamId): void => {
    if (!ready) return
    if (refreshing.get(stream) !== undefined) {
      refreshing.set(stream, true)
      return
    }
    refreshing.set(stream, false)
    const { engine, memory } = ready
    void (async () => {
      do {
        refreshing.set(stream, false)
        const view = await engine.readView({ stream, kind: 'compact' })
        const from = injection.knownLength(stream)
        if (view.throughPos > from) injection.extendConversations(stream, from, await memory.store.streamConversations(stream, from, view.throughPos))
        injection.setView(view)
      } while (refreshing.get(stream) === true)
    })()
      .catch((error: unknown) => logger.warn('optmem: compact view refresh failed for %s: %s', stream, errorMessage(error)))
      .finally(() => refreshing.delete(stream))
  }

  const openEngine = async (memory: SqliteMemory): Promise<MemoryEngine> => {
    const engine = createMemoryEngine({
      store: memory.store,
      search: memory.search,
      summarizer: services.createSummarizer(),
      config: engineConfig(options.settings()),
      logger: { warn: (message, fields) => logger.warn('optmem: %s %o', message, fields) },
      onViewCommitted: event => {
        if (event.kind === 'compact' && injectedStreams.has(event.stream)) refreshStream(event.stream)
      },
    })
    await engine.start()
    return engine
  }

  const start = async (): Promise<void> => {
    if (state === 'starting' || state === 'ready') return
    if (!options.settings().enabled) return
    state = 'starting'
    let memory: SqliteMemory | undefined
    try {
      memory = openSqliteMemory({ path: options.databasePath })
      const engine = await openEngine(memory)
      ready = { memory, engine }
      state = 'ready'
      failure = null
      const check = modeCheck()
      if (!check.ok) logger.warn('optmem: %s; running in compatibility mode', check.message)
      for (const { stream } of await memory.store.listStreams()) {
        if (!stream.startsWith('project:')) continue
        injectedStreams.add(stream)
        refreshStream(stream)
      }
      scheduleFlush()
    } catch (error) {
      memory?.close()
      ready = undefined
      state = 'failed'
      failure = errorMessage(error)
      logger.warn('optmem: memory store unavailable, tools and injection are degraded: %s', failure)
    }
  }

  const shutdown = async (): Promise<void> => {
    const current = ready
    ready = undefined
    state = 'off'
    if (!current) return
    try {
      await current.engine.close()
    } finally {
      current.memory.close()
    }
  }

  const stop = async (): Promise<void> => {
    await flushing.catch(() => {})
    await shutdown()
  }

  const flush = async (): Promise<void> => {
    flushScheduled = false
    const current = ready
    if (!current) return
    const batch = queue
    queue = []
    const inputs: MemoryEventInput[] = []
    for (const item of batch) {
      const projectId = await resolveProject(item.session.header)
      const input = capture.toMemoryEvent({ session: item.session, event: item.event, projectId, policy: policy() })
      if (input) inputs.push(input)
      else skipped++
    }
    if (inputs.length === 0) return
    const result = await current.engine.append(inputs)
    captured += result.inserted
  }

  const scheduleFlush = (): void => {
    if (flushScheduled || queue.length === 0 || !ready) return
    flushScheduled = true
    flushing = flushing
      .then(() => new Promise<void>(done => setImmediate(done)))
      .then(flush)
      .catch((error: unknown) => {
        lastCaptureError = errorMessage(error)
        logger.warn('optmem: capture failed, events of this batch are not in memory: %s', lastCaptureError)
      })
  }

  /** `session/event` listener: synchronous, never throws, does no I/O on the caller's stack. */
  const onSessionEvent = (session: CaptureSession, event: SessionEvent): void => {
    try {
      if (!options.settings().enabled || (state !== 'ready' && state !== 'starting')) return
      if (event.type !== 'user/message' && event.type !== 'assistant/message' && event.type !== 'tool/call' && event.type !== 'tool/result') return
      void resolveProject(session.header)
      queue.push({ session: { id: session.id, header: session.header }, event })
      scheduleFlush()
    } catch (error) {
      lastCaptureError = errorMessage(error)
    }
  }

  const access = async (agent: { readonly id: string; readonly session: { readonly header: CaptureHeader } }): Promise<MemoryAccess> => ({
    conversationId: agent.id,
    projectId: await resolveProject(agent.session.header),
    allowAllProjects: options.settings().allowAllProjects,
  })

  const requireEngine = (): MemoryEngine => {
    if (!options.settings().enabled) throw new Error('OptMem is disabled (setting dshfiles-optmem.enabled).')
    if (!ready) throw new Error(`OptMem memory is unavailable (${state}${failure ? `: ${failure}` : ''}).`)
    return ready.engine
  }

  /** Prompt-context provider: synchronous and cache-only, so assembly never waits on SQLite. */
  const promptText = (agent: { readonly id: string; readonly session: { readonly header: CaptureHeader } } | undefined): string => {
    try {
      if (!agent || !ready || !options.settings().enabled) return ''
      const projectId = projects.get(agent.id)
      if (projectId === undefined) {
        void resolveProject(agent.session.header)
        return ''
      }
      const stream = projectId === null ? StreamIds.conversation(agent.id) : StreamIds.project(projectId)
      if (!injectedStreams.has(stream)) {
        injectedStreams.add(stream)
        refreshStream(stream)
        return ''
      }
      return injection.render({ stream, conversationId: agent.id, budgetBytes: options.settings().injectUpperBytes })
    } catch (error) {
      logger.warn('optmem: prompt context failed: %s', errorMessage(error))
      return ''
    }
  }

  const applySettings = (next: OptmemSettings): Promise<void> => {
    const previous = appliedSettings
    appliedSettings = next
    flushing = flushing.then(async () => {
      try {
        if (!next.enabled) return await shutdown()
        if (!previous.enabled || state !== 'ready') return await start()
        if (engineKeys.some(key => previous[key] !== next[key]) && ready) {
          const current = ready
          ready = undefined
          await current.engine.close()
          ready = { memory: current.memory, engine: await openEngine(current.memory) }
          for (const stream of injectedStreams) refreshStream(stream)
        }
      } catch (error) {
        state = 'failed'
        failure = errorMessage(error)
        logger.warn('optmem: applying settings failed: %s', failure)
      }
    })
    return flushing
  }

  const backfill = async (limit: number): Promise<string> => {
    const progressPath = join(dirname(options.databasePath), 'backfill.json')
    const engine = requireEngine()
    const sessionQuery = services.sessionLogs()
    if (!sessionQuery) throw new Error('the DSH sessionQuery service is unavailable')
    const progress: BackfillProgress = await readFile(progressPath, 'utf8')
      .then((text): BackfillProgress => {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null || !('sessions' in parsed) || typeof parsed.sessions !== 'object' || parsed.sessions === null) return { sessions: {} }
        return { sessions: Object.fromEntries(Object.entries(parsed.sessions).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) }
      })
      .catch(() => ({ sessions: {} }))
    const records = await sessionQuery.listSessions()
    let sessions = 0
    let inserted = 0
    for (const record of records) {
      if (sessions >= limit) break
      const header = record.header
      if (header.origin === 'subagent' && !options.settings().captureSubagents) continue
      const log = await sessionQuery.readSession(header.id)
      const lastSeq = log.events.at(-1)?.seq ?? -1
      if ((progress.sessions[header.id] ?? -1) >= lastSeq) continue
      sessions++
      const projectId = await resolveProject(log.session)
      const inputs = log.events.slice(log.inheritedEventCount).flatMap(event => capture.toMemoryEvent({ session: { id: header.id, header: log.session }, event, projectId, policy: policy() }) ?? [])
      for (let index = 0; index < inputs.length; index += 500) inserted += (await engine.append(inputs.slice(index, index + 500))).inserted
      progress.sessions[header.id] = lastSeq
      await writeFile(progressPath, JSON.stringify(progress), { mode: 0o600 })
    }
    const remaining = records.filter(record => (progress.sessions[record.header.id] ?? -1) < 0).length
    return `Backfilled ${sessions} session(s), ${inserted} new memory event(s). ${remaining} session(s) never backfilled; run again to continue.`
  }

  return {
    start,
    stop,
    onSessionEvent,
    resolveProject,
    access,
    requireEngine,
    promptText,
    applySettings,
    backfill,
    /** Test and status seam: resolves once queued captures are appended. */
    settle: async (): Promise<void> => {
      scheduleFlush()
      await flushing
    },
    status: () => ({
      state,
      failure,
      captured,
      skipped,
      queued: queue.length,
      lastCaptureError,
      summarizer: services.summarizerRoute(),
      capabilities: capabilities(),
      mode: modeCheck(),
      database: options.databasePath,
      settings: options.settingsSource?.() ?? 'entry',
    }),
  }
}

export type OptmemRuntime = ReturnType<typeof createOptmemRuntime>
