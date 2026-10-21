import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { agentSchema, agentThreadSchema, Agents, MAX_AGENTS, MAX_THREADS_PER_AGENT, type Agent, type AgentDraft, type AgentThread } from './agent.js'

export const agentsDomain = defineDomain({
  name: 'agents',
  version: 1,
  tables: {
    agents: { valueSchema: agentSchema, __key: 'agents' },
    threads: { valueSchema: agentThreadSchema, __key: 'threads' },
  },
})

export type AgentTable = KvTable<string, Agent>
export type AgentThreadTable = KvTable<string, AgentThread>

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

export interface AgentsStore {
  snapshot(): AgentSnapshot
  resolve(handle: string): Agent | null
  save(draft: AgentDraft): Promise<AgentSaveResult>
  remove(handle: string): Promise<AgentRemoveResult>
  recordUse(handle: string, thread?: { readonly sessionId: string; readonly title: string }): Promise<AgentSnapshot>
  threads(handle: string): AgentThread[]
  threadAgent(sessionId: string): Agent | null
  flush(): Promise<void>
}

/** Monotone across restarts: revisions outrank every value a reader already saw. */
const nextRevision = (current: number, now: number): number => Math.max(current + 1, now)

const createAgentsStore = ({
  table,
  threads,
  now = Date.now,
  reportError = (error: unknown) =>
    console.error('Agent registry write failed', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
}: {
  readonly table: AgentTable
  readonly threads: AgentThreadTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): AgentsStore => {
  const records = new Map<string, Agent>(table.entries())
  const history = new Map<string, AgentThread>(threads.entries())
  // The built-in `@dsh` agent exists without setup; an edit to it survives, so it is only seeded while absent.
  const seeded = Agents.builtIn(now())
  const seededNow = !records.has(seeded.handle)
  if (seededNow) records.set(seeded.handle, seeded)
  let revision = Math.max(now(), ...[...records.values()].map(agent => agent.updatedAt))
  let writes: Promise<void> = Promise.resolve()

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = writes.then(operation).then(() => undefined)
    writes = result.catch(() => undefined)
    return result
  }

  // The built-in agent is a real row, so a store opened after this one does not depend on seeding again.
  if (seededNow) void enqueue(() => table.put(seeded.handle, seeded)).catch(reportError)

  const snapshot = (): AgentSnapshot => ({ revision, agents: Agents.order(records.values()) })

  /** Newest first, and only the rows the panel shows: one agent's history is bounded at its dispatch end. */
  const threadsOf = (handle: string, limit = MAX_THREADS_PER_AGENT): AgentThread[] =>
    [...history.values()]
      .filter(thread => thread.handle === handle)
      .sort((left, right) => right.startedAt - left.startedAt)
      .slice(0, limit)

  return {
    snapshot,
    resolve: handle => records.get(handle) ?? null,
    save: async draft => {
      const existing = records.get(draft.handle)
      if (existing === undefined && records.size >= MAX_AGENTS) return { kind: 'limit', ...snapshot() }
      const at = now()
      const agent: Agent = {
        ...draft,
        builtIn: existing?.builtIn ?? false,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
        lastUsedAt: existing?.lastUsedAt ?? null,
        threadCount: existing?.threadCount ?? 0,
      }
      records.set(agent.handle, agent)
      revision = nextRevision(revision, at)
      await enqueue(() => table.put(agent.handle, agent)).catch(reportError)
      return { kind: 'applied', ...snapshot(), agent }
    },
    remove: async handle => {
      const existing = records.get(handle)
      if (existing === undefined) return { kind: 'missing', ...snapshot() }
      if (existing.builtIn) return { kind: 'built-in', ...snapshot() }
      records.delete(handle)
      const orphaned = [...history.values()].filter(thread => thread.handle === handle)
      for (const thread of orphaned) history.delete(thread.sessionId)
      revision = nextRevision(revision, now())
      await enqueue(async () => {
        await table.delete(handle)
        for (const thread of orphaned) await threads.delete(thread.sessionId)
      }).catch(reportError)
      const current = snapshot()
      return { kind: 'applied', ...current }
    },
    threads: handle => threadsOf(handle),
    threadAgent: sessionId => {
      const thread = history.get(sessionId)
      return thread === undefined ? null : (records.get(thread.handle) ?? null)
    },
    recordUse: async (handle, thread) => {
      const existing = records.get(handle)
      if (existing === undefined) return snapshot()
      const at = now()
      const started: AgentThread | null = thread === undefined ? null : { sessionId: thread.sessionId, handle, title: thread.title, startedAt: at }
      if (started !== null) history.set(started.sessionId, started)
      const count = started === null ? existing.threadCount + 1 : threadsOf(handle, Number.POSITIVE_INFINITY).length
      const agent: Agent = { ...existing, lastUsedAt: at, updatedAt: existing.updatedAt, threadCount: count }
      records.set(handle, agent)
      revision = nextRevision(revision, at)
      const pruned = started === null ? [] : threadsOf(handle, Number.POSITIVE_INFINITY).slice(MAX_THREADS_PER_AGENT)
      for (const thread of pruned) history.delete(thread.sessionId)
      await enqueue(async () => {
        if (started !== null) await threads.put(started.sessionId, started)
        for (const old of pruned) await threads.delete(old.sessionId)
        await table.put(handle, agent)
      }).catch(reportError)
      return snapshot()
    },
    flush: () => writes,
  }
}

export class AgentRegistry {
  static readonly createStore = createAgentsStore
}
