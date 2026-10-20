import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineHost } from '@dshfiles/dshx/host'
import { agentsApi, type AgentPresetRow } from './api.js'
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
    store: AgentRegistry.createStore({ table: domain.table('agents') }),
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
  recordUse: async ({ ctx, input }) => (await agentsFor(ctx)).recordUse(input.handle),
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
  },
})
