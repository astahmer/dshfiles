import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain, type StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { Clock, Context, Effect, Layer, Ref } from 'effect'
import { agentSchema, agentThreadSchema, Agents, MAX_AGENTS, MAX_THREADS_PER_AGENT, type Agent, type AgentDraft, type AgentThread } from './agent.js'

export const agentsDomain = defineDomain({
  name: 'agents',
  version: 1,
  tables: {
    agents: { valueSchema: zodSchemaFromEffect(agentSchema), __key: 'agents' },
    threads: { valueSchema: zodSchemaFromEffect(agentThreadSchema), __key: 'threads' },
  },
})

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
  }
>()('@dshfiles/agents/AgentsRegistry') {
  static readonly layer = Layer.effect(
    AgentsRegistry,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const domain = yield* storage.open(agentsDomain)
      const agentRows = domain.table('agents')
      const threadRows = domain.table('threads')
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
        return snapshotOf(next)
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
      })
    }),
  )
}
