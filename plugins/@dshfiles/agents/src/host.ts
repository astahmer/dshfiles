import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineHost } from '@dshfiles/dshx/host'
import { agentsApi, type AgentPresetRow } from './api.js'
import { DelegationGuard } from './delegation-guard.js'
import { AgentRegistry, agentsDomain, type AgentsStore } from './store.js'

interface OpenedAgents {
  readonly store: AgentsStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: the API handlers and the setup effect receive different
 * contexts, and a second store would keep its own record map and clobber the other's durable rows.
 */
let opening: Promise<OpenedAgents> | undefined

const openAgents = async (ctx: Context): Promise<OpenedAgents> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Agent registry storage is unavailable.')
  const domain = await storage.open(agentsDomain)
  return {
    store: AgentRegistry.createStore({ table: domain.table('agents'), threads: domain.table('threads') }),
    close: () => domain.close(),
  }
}

const agentsFor = (ctx: Context): Promise<AgentsStore> => {
  if (opening === undefined) {
    const started = openAgents(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening.then(opened => opened.store)
}

const closeAgents = async (): Promise<void> => {
  if (opening === undefined) return
  const opened = await opening.then(
    value => value,
    () => undefined,
  )
  opening = undefined
  if (opened === undefined) return
  await opened.store.flush()
  await opened.close()
}

const agentsApiHost = agentsApi.host({
  list: async ({ ctx }) => (await agentsFor(ctx)).snapshot(),
  get: async ({ ctx, input }) => ({ agent: (await agentsFor(ctx)).resolve(input.handle) }),
  presets: async ({ ctx }) => {
    const presets = ctx.get('agentPresets')
    if (presets === undefined) return { presets: [] }
    const rows = await presets.list()
    return {
      presets: rows.map(row => {
        const preset: AgentPresetRow = { id: row.id }
        if (row.name !== undefined) preset.name = row.name
        if (row.description !== undefined) preset.description = row.description
        if (row.broken !== undefined) preset.broken = row.broken
        return preset
      }),
    }
  },
  save: async ({ ctx, input }) => (await agentsFor(ctx)).save(input.agent),
  remove: async ({ ctx, input }) => (await agentsFor(ctx)).remove(input.handle),
  recordUse: async ({ ctx, input }) => (await agentsFor(ctx)).recordUse(input.handle, input.thread),
  threads: async ({ ctx, input }) => ({ threads: (await agentsFor(ctx)).threads(input.handle) }),
  threadAgent: async ({ ctx, input }) => ({ agent: (await agentsFor(ctx)).threadAgent(input.sessionId) }),
})

export default defineHost({
  name: '@dshfiles/agents',
  inject: ['storageDomain'],
  apis: [agentsApiHost],
  setup: ctx => {
    ctx.effect(() => {
      const started = agentsFor(ctx)
      void started.catch(() => undefined)
      return async () => {
        await closeAgents()
      }
    }, 'agents: registry store')
    // The guard is synchronous, so it reads the same in-memory store the API serves: registering a subagent or a
    // workflow is denied before dispatch when the agent that started the thread set `delegation.subagents: false`.
    ctx.effect(() => {
      const tools = ctx.get('tools')
      if (tools === undefined) return () => undefined
      let closed = false
      let dispose: (() => void) | undefined
      void agentsFor(ctx)
        .then(store => {
          if (closed) return
          dispose = tools.guard(execution =>
            DelegationGuard.refusal({ toolName: execution.name, agent: execution.agent === undefined ? null : store.threadAgent(execution.agent.id) }),
          )
        })
        .catch(() => undefined)
      return () => {
        closed = true
        dispose?.()
      }
    }, 'agents: delegation guard')
  },
})
