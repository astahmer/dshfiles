import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain, type StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { ToolAccess, type ToolAccessEntry, type ToolAccessPolicy, type ToolAccessSubject } from '@dshfiles/tool-search/access'
import { Clock, Context, Effect, Layer, Ref } from 'effect'
import {
  agentSchema,
  agentThreadSchema,
  Agents,
  MAX_AGENTS,
  MAX_THREADS_PER_AGENT,
  type Agent,
  type AgentDraft,
  type AgentSubagents,
  type AgentThread,
} from './agent.js'
import { ProjectLocator } from './project-locator.js'
import {
  projectDefaultSchema,
  threadAgentSchema,
  ThreadAgents,
  type ProjectDefault,
  type ThreadAccessView,
  type ThreadAgent,
  type ThreadToolOverrideRequest,
} from './thread-agents.js'

export const agentsDomain = defineDomain({
  name: 'agents',
  version: 1,
  tables: {
    agents: { valueSchema: zodSchemaFromEffect(agentSchema), __key: 'agents' },
    threads: { valueSchema: zodSchemaFromEffect(agentThreadSchema), __key: 'threads' },
    /** Each thread's agent, decided once when its DSH agent attached. */
    sessions: { valueSchema: zodSchemaFromEffect(threadAgentSchema), __key: 'sessions' },
    /** Each DSH project's default agent, by project workspace id. */
    projects: { valueSchema: zodSchemaFromEffect(projectDefaultSchema), __key: 'projects' },
  },
})

/** One edit of an agent's tool access: a tool name or a group key, and its new entry (null removes it). */
export interface ToolAccessEdit {
  readonly target: { readonly kind: 'tool' | 'group'; readonly key: string }
  readonly entry: ToolAccessEntry | null
}

export type AgentUpdateResult =
  | { readonly kind: 'applied'; readonly revision: number; readonly agent: Agent }
  | { readonly kind: 'missing'; readonly revision: number }

export type ProjectDefaultResult =
  | { readonly kind: 'applied'; readonly projects: ProjectDefault[] }
  | { readonly kind: 'missing-agent'; readonly projects: ProjectDefault[] }

export type ThreadOverrideResult =
  | { readonly kind: 'applied'; readonly view: ThreadAccessView }
  | { readonly kind: 'missing-agent'; readonly view: ThreadAccessView }

export interface AgentSnapshot {
  readonly revision: number
  readonly agents: Agent[]
}

export type AgentSaveResult =
  | { readonly kind: 'applied'; readonly revision: number; readonly agents: Agent[]; readonly agent: Agent }
  | { readonly kind: 'limit'; readonly revision: number; readonly agents: Agent[] }

export type AgentRemoveResult =
  | { readonly kind: 'applied'; readonly revision: number; readonly agents: Agent[] }
  | { readonly kind: 'built-in'; readonly revision: number; readonly agents: Agent[] }
  | { readonly kind: 'missing'; readonly revision: number; readonly agents: Agent[] }

interface RegistryState {
  readonly revision: number
  readonly records: ReadonlyMap<string, Agent>
  readonly history: ReadonlyMap<string, AgentThread>
}

const snapshotOf = (state: RegistryState): AgentSnapshot => ({ revision: state.revision, agents: Agents.order(state.records.values()) })

/** Newest first, and only the rows the panel shows: one agent's history is bounded at its dispatch end. */
const threadsOf = (history: ReadonlyMap<string, AgentThread>, handle: string, limit = MAX_THREADS_PER_AGENT): AgentThread[] =>
  [...history.values()]
    .filter(thread => thread.handle === handle)
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, limit)

const agentOfThread = (state: RegistryState, sessionId: string): Agent | null => {
  const thread = state.history.get(sessionId)
  return thread === undefined ? null : (state.records.get(thread.handle) ?? null)
}

/** The durable agent registry: rows live in the `agents` storage domain, reads come from the in-memory copy. */
export class AgentsRegistry extends Context.Service<
  AgentsRegistry,
  {
    readonly snapshot: Effect.Effect<AgentSnapshot>
    readonly resolve: (handle: string) => Effect.Effect<Agent | null>
    readonly save: (draft: AgentDraft) => Effect.Effect<AgentSaveResult>
    readonly remove: (handle: string) => Effect.Effect<AgentRemoveResult>
    readonly recordUse: (handle: string, thread?: { readonly sessionId: string; readonly title: string }) => Effect.Effect<AgentSnapshot>
    readonly threads: (handle: string) => Effect.Effect<AgentThread[]>
    readonly threadAgent: (sessionId: string) => Effect.Effect<Agent | null>
    /** The same read as `threadAgent`, for a synchronous Host guard that cannot run an Effect. */
    readonly threadAgentNow: (sessionId: string) => Agent | null
    /** Every remembered thread with the handle of the configured agent that started it, for thread lists. */
    readonly threadHandles: Effect.Effect<readonly { readonly sessionId: string; readonly handle: string }[]>
    /** Edit an agent's tool access, one sparse entry at a time; threads started afterwards get it. */
    readonly editToolAccess: (handle: string, edits: readonly ToolAccessEdit[]) => Effect.Effect<AgentUpdateResult>
    readonly setSubagents: (handle: string, subagents: AgentSubagents) => Effect.Effect<AgentUpdateResult>
    readonly projectDefaults: Effect.Effect<ProjectDefault[]>
    /** Set (or clear with null) a project's default agent; threads started afterwards in that project get it. */
    readonly setProjectDefault: (projectId: string, handle: string | null) => Effect.Effect<ProjectDefaultResult>
    /**
     * Decide (once) and record the agent of a live Session, synchronously: tool-search calls it while the agent
     * attaches. A recorded Session returns its record unchanged.
     */
    readonly threadPolicyNow: (subject: ToolAccessSubject) => ToolAccessPolicy
    /** A Session's agent and policy: its record, or a preview of what it would resolve to when none is recorded yet. */
    readonly threadAccess: (subject: {
      readonly sessionId: string
      readonly cwd?: string | undefined
      readonly parentSessionId?: string | undefined
    }) => Effect.Effect<ThreadAccessView>
    /** Record a thread's agent explicitly (a dispatch, a mention, a subagent started with an agent); replaces an earlier decision. */
    readonly recordThreadAgent: (sessionId: string, handle: string) => Effect.Effect<ThreadAccessView | null>
    /** Set or clear a thread's tool override; tool-search applies it from the thread's next model request. */
    readonly setThreadOverride: (sessionId: string, request: ThreadToolOverrideRequest) => Effect.Effect<ThreadOverrideResult>
    /** Sessions whose tool policy changed (an override, or a late explicit record). */
    readonly subscribe: (listener: (sessionId: string) => void) => () => void
  }
>()('@dshfiles/agents/AgentsRegistry') {
  static readonly layer = Layer.effect(
    AgentsRegistry,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const domain = yield* storage.open(agentsDomain)
      const agentRows = domain.table('agents')
      const threadRows = domain.table('threads')
      const sessionRows = domain.table('sessions')
      const projectRows = domain.table('projects')
      const locator = yield* ProjectLocator
      const runFork = Effect.runForkWith(yield* Effect.context<never>())
      const persist = (write: Effect.Effect<unknown, StorageDomainWriteFailed>) =>
        write.pipe(Effect.catchTag('StorageDomainWriteFailed', error => Effect.logError('Agent registry write failed', error)))

      const openedAt = yield* Clock.currentTimeMillis
      const records = new Map(yield* agentRows.entries)
      // The built-in `@dsh` agent exists without setup; an edit to it survives, so it is only seeded while absent.
      const seeded = Agents.builtIn(openedAt)
      if (!records.has(seeded.handle)) {
        records.set(seeded.handle, seeded)
        yield* persist(agentRows.put(seeded.handle, seeded))
      }
      const state = yield* Ref.make<RegistryState>({
        revision: Math.max(openedAt, ...[...records.values()].map(agent => agent.updatedAt)),
        records,
        history: new Map(yield* threadRows.entries),
      })

      /** Each thread's agent and each project's default: read synchronously while an agent attaches, so plain maps. */
      const decided = new Map(yield* sessionRows.entries)
      const projectDefaults = new Map(yield* projectRows.entries)
      const listeners = new Set<(sessionId: string) => void>()
      const notify = (sessionId: string) => {
        for (const listener of listeners) listener(sessionId)
      }

      /** Keep a decision, dropping the oldest past the bound; the write is durable later, the decision holds now. */
      const keepDecision = (record: ThreadAgent): Effect.Effect<void> => {
        decided.set(record.sessionId, record)
        const dropped = ThreadAgents.overflow(decided)
        for (const sessionId of dropped) decided.delete(sessionId)
        return persist(
          Effect.gen(function* () {
            yield* sessionRows.put(record.sessionId, record)
            for (const sessionId of dropped) yield* sessionRows.delete(sessionId)
          }),
        )
      }

      const resolutionState = () => {
        const current = Ref.getUnsafe(state)
        return {
          agents: current.records,
          dispatched: new Map([...current.history.values()].map(thread => [thread.sessionId, thread.handle] as const)),
          decided,
          projectDefaults,
        }
      }

      const subjectOf = (subject: { readonly sessionId: string; readonly cwd?: string | undefined; readonly parentSessionId?: string | undefined }) => ({
        sessionId: subject.sessionId,
        parentSessionId: subject.parentSessionId,
        projectId: locator.projectOf({ sessionId: subject.sessionId, cwd: subject.cwd }),
      })

      const viewOf = (record: ThreadAgent, recorded: boolean): ThreadAccessView => ({
        sessionId: record.sessionId,
        recorded,
        agent: record,
        policy: ThreadAgents.policyOf(record),
      })

      /** Every mutation holds the domain write lock, so it reads and replaces the state without a lost update. Revisions stay monotone across restarts. */
      const commit = Effect.fnUntraced(function* (next: Omit<RegistryState, 'revision'>, now: number) {
        return yield* Ref.updateAndGet(state, current => ({ ...next, revision: Math.max(current.revision + 1, now) }))
      })

      const save = Effect.fn('agents save')(function* (draft: AgentDraft) {
        const current = yield* Ref.get(state)
        const existing = current.records.get(draft.handle)
        if (existing === undefined && current.records.size >= MAX_AGENTS) return { kind: 'limit' as const, ...snapshotOf(current) }
        const now = yield* Clock.currentTimeMillis
        const agent: Agent = {
          ...draft,
          builtIn: existing?.builtIn ?? false,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          lastUsedAt: existing?.lastUsedAt ?? null,
          threadCount: existing?.threadCount ?? 0,
        }
        const next = yield* commit({ records: new Map(current.records).set(agent.handle, agent), history: current.history }, now)
        yield* persist(agentRows.put(agent.handle, agent))
        return { kind: 'applied' as const, ...snapshotOf(next), agent }
      }, domain.withWriteLock)

      const remove = Effect.fn('agents remove')(function* (handle: string) {
        const current = yield* Ref.get(state)
        const existing = current.records.get(handle)
        if (existing === undefined) return { kind: 'missing' as const, ...snapshotOf(current) }
        if (existing.builtIn) return { kind: 'built-in' as const, ...snapshotOf(current) }
        const orphaned = [...current.history.values()].filter(thread => thread.handle === handle)
        const records = new Map(current.records)
        records.delete(handle)
        const history = new Map(current.history)
        for (const thread of orphaned) history.delete(thread.sessionId)
        const next = yield* commit({ records, history }, yield* Clock.currentTimeMillis)
        yield* persist(
          Effect.gen(function* () {
            yield* agentRows.delete(handle)
            for (const thread of orphaned) yield* threadRows.delete(thread.sessionId)
          }),
        )
        return { kind: 'applied' as const, ...snapshotOf(next) }
      }, domain.withWriteLock)

      const recordUse = Effect.fn('agents record use')(function* (handle: string, thread?: { readonly sessionId: string; readonly title: string }) {
        const current = yield* Ref.get(state)
        const existing = current.records.get(handle)
        if (existing === undefined) return snapshotOf(current)
        const now = yield* Clock.currentTimeMillis
        const started: AgentThread | null = thread === undefined ? null : { sessionId: thread.sessionId, handle, title: thread.title, startedAt: now }
        const history = new Map(current.history)
        if (started !== null) history.set(started.sessionId, started)
        const count = started === null ? existing.threadCount + 1 : threadsOf(history, handle, Number.POSITIVE_INFINITY).length
        const agent: Agent = { ...existing, lastUsedAt: now, threadCount: count }
        const pruned = started === null ? [] : threadsOf(history, handle, Number.POSITIVE_INFINITY).slice(MAX_THREADS_PER_AGENT)
        for (const old of pruned) history.delete(old.sessionId)
        const next = yield* commit({ records: new Map(current.records).set(handle, agent), history }, now)
        yield* persist(
          Effect.gen(function* () {
            if (started !== null) yield* threadRows.put(started.sessionId, started)
            for (const old of pruned) yield* threadRows.delete(old.sessionId)
            yield* agentRows.put(handle, agent)
          }),
        )
        // A dispatch is explicit: when the thread's agent attached before the dispatch was recorded, it becomes this one.
        if (started !== null) yield* explicitDecision(started.sessionId, handle, now)
        return snapshotOf(next)
      }, domain.withWriteLock)

      /** Record `handle` as a thread's explicit agent, keeping its override; notify when an attached thread's policy changed. */
      const explicitDecision = (sessionId: string, handle: string, now: number) =>
        Effect.gen(function* () {
          const agents = Ref.getUnsafe(state).records
          const agent = agents.get(handle)
          if (agent === undefined) return null
          const previous = decided.get(sessionId)
          if (previous?.resolution === 'explicit' && previous.handle === handle) return viewOf(previous, true)
          const record: ThreadAgent = {
            sessionId,
            handle,
            resolution: 'explicit',
            projectId: previous?.projectId ?? null,
            inheritedFrom: null,
            access: { tools: { ...agent.tools.tools }, groups: { ...agent.tools.groups } },
            decidedAt: previous?.decidedAt ?? now,
            override: previous?.override ?? null,
          }
          yield* keepDecision(record)
          if (previous !== undefined) notify(sessionId)
          return viewOf(record, true)
        })

      const updateAgent = (handle: string, change: (agent: Agent) => Agent) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          const existing = current.records.get(handle)
          if (existing === undefined) return { kind: 'missing' as const, revision: current.revision }
          const now = yield* Clock.currentTimeMillis
          const agent: Agent = { ...change(existing), updatedAt: now }
          const next = yield* commit({ records: new Map(current.records).set(handle, agent), history: current.history }, now)
          yield* persist(agentRows.put(handle, agent))
          return { kind: 'applied' as const, revision: next.revision, agent }
        })

      const editToolAccess = Effect.fn('agents tool access edit')(function* (handle: string, edits: readonly ToolAccessEdit[]) {
        yield* Effect.annotateCurrentSpan({ edits: edits.length })
        return yield* updateAgent(handle, agent => ({
          ...agent,
          tools: edits.reduce((access, edit) => ToolAccess.withEntry(access, edit.target, edit.entry), agent.tools),
        }))
      }, domain.withWriteLock)

      const setSubagents = Effect.fn('agents subagents set')(function* (handle: string, subagents: AgentSubagents) {
        return yield* updateAgent(handle, agent => ({ ...agent, subagents }))
      }, domain.withWriteLock)

      const listProjectDefaults = () => [...projectDefaults.values()].sort((left, right) => left.projectId.localeCompare(right.projectId))

      const setProjectDefault = Effect.fn('agents project default set')(function* (projectId: string, handle: string | null) {
        if (handle === null) {
          projectDefaults.delete(projectId)
          yield* persist(projectRows.delete(projectId))
          return { kind: 'applied' as const, projects: listProjectDefaults() }
        }
        if (!(yield* Ref.get(state)).records.has(handle)) return { kind: 'missing-agent' as const, projects: listProjectDefaults() }
        const record: ProjectDefault = { projectId, handle, updatedAt: yield* Clock.currentTimeMillis }
        projectDefaults.set(projectId, record)
        yield* persist(projectRows.put(projectId, record))
        return { kind: 'applied' as const, projects: listProjectDefaults() }
      }, domain.withWriteLock)

      const threadPolicyNow = (subject: ToolAccessSubject): ToolAccessPolicy => {
        const existing = decided.get(subject.sessionId)
        if (existing !== undefined) return ThreadAgents.policyOf(existing)
        const record = ThreadAgents.decide(resolutionState(), subjectOf(subject), Date.now())
        runFork(keepDecision(record).pipe(Effect.withSpan('agents thread agent decide', { attributes: { resolution: record.resolution } })))
        return ThreadAgents.policyOf(record)
      }

      const threadAccess = (subject: { readonly sessionId: string; readonly cwd?: string | undefined; readonly parentSessionId?: string | undefined }) =>
        Effect.gen(function* () {
          const existing = decided.get(subject.sessionId)
          if (existing !== undefined) return viewOf(existing, true)
          return viewOf(ThreadAgents.decide(resolutionState(), subjectOf(subject), yield* Clock.currentTimeMillis), false)
        })

      const recordThreadAgent = Effect.fn('agents thread agent record')(function* (sessionId: string, handle: string) {
        return yield* explicitDecision(sessionId, handle, yield* Clock.currentTimeMillis)
      }, domain.withWriteLock)

      const setThreadOverride = Effect.fn('agents thread override set')(function* (sessionId: string, request: ThreadToolOverrideRequest) {
        const now = yield* Clock.currentTimeMillis
        const record = decided.get(sessionId) ?? ThreadAgents.decide(resolutionState(), subjectOf({ sessionId }), now)
        const override = ThreadAgents.overrideOf((yield* Ref.get(state)).records, request)
        if (override === undefined) return { kind: 'missing-agent' as const, view: viewOf(record, decided.has(sessionId)) }
        const next: ThreadAgent = { ...record, override }
        yield* keepDecision(next)
        notify(sessionId)
        return { kind: 'applied' as const, view: viewOf(next, true) }
      }, domain.withWriteLock)

      return AgentsRegistry.of({
        snapshot: Effect.map(Ref.get(state), snapshotOf),
        resolve: handle => Effect.map(Ref.get(state), current => current.records.get(handle) ?? null),
        save,
        remove,
        recordUse,
        threads: handle => Effect.map(Ref.get(state), current => threadsOf(current.history, handle)),
        threadAgent: sessionId => Effect.map(Ref.get(state), current => agentOfThread(current, sessionId)),
        threadAgentNow: sessionId => agentOfThread(Ref.getUnsafe(state), sessionId),
        threadHandles: Effect.map(Ref.get(state), current =>
          [...current.history.values()].flatMap(thread => (current.records.has(thread.handle) ? [{ sessionId: thread.sessionId, handle: thread.handle }] : [])),
        ),
        editToolAccess,
        setSubagents,
        projectDefaults: Effect.sync(listProjectDefaults),
        setProjectDefault,
        threadPolicyNow,
        threadAccess,
        recordThreadAgent,
        setThreadOverride,
        subscribe: listener => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      })
    }),
  )
}
