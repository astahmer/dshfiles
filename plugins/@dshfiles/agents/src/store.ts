import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { agentSchema, Agents, MAX_AGENTS, type Agent, type AgentDraft } from './agent.js'

export const agentsDomain = defineDomain({
  name: 'agents',
  version: 1,
  tables: {
    agents: { valueSchema: agentSchema, __key: 'agents' },
  },
})

export type AgentTable = KvTable<string, Agent>

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
  recordUse(handle: string): Promise<AgentSnapshot>
  flush(): Promise<void>
}

/** Monotone across restarts: revisions outrank every value a reader already saw. */
const nextRevision = (current: number, now: number): number => Math.max(current + 1, now)

const createAgentsStore = ({
  table,
  now = Date.now,
  reportError = (error: unknown) =>
    console.error('Agent registry write failed', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
}: {
  readonly table: AgentTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): AgentsStore => {
  const records = new Map<string, Agent>(table.entries())
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
      revision = nextRevision(revision, now())
      await enqueue(async () => {
        await table.delete(handle)
      }).catch(reportError)
      const current = snapshot()
      return { kind: 'applied', ...current }
    },
    recordUse: async handle => {
      const existing = records.get(handle)
      if (existing === undefined) return snapshot()
      const at = now()
      const agent: Agent = { ...existing, lastUsedAt: at, updatedAt: existing.updatedAt, threadCount: existing.threadCount + 1 }
      records.set(handle, agent)
      revision = nextRevision(revision, at)
      await enqueue(() => table.put(handle, agent)).catch(reportError)
      return snapshot()
    },
    flush: () => writes,
  }
}

export class AgentRegistry {
  static readonly createStore = createAgentsStore
}
