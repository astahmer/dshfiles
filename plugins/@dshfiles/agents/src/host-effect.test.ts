import { createHostApiClient } from '@dshfiles/dshx/host'
import { mountPlugin, createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import type { Agent, AgentDraft, AgentThread } from './agent.js'
import { agentsApi } from './api.js'
import plugin from './host.js'

const draft: AgentDraft = {
  handle: 'reviewer',
  name: 'Reviewer',
  glyph: '🤖',
  description: '',
  instructions: '',
  preset: null,
  route: null,
  memoryScope: null,
  routine: '',
  delegation: { messaging: 'any', handles: [], subagents: true },
  enabled: true,
}

const memoryTable = <Value>() => {
  const rows = new Map<string, Value>()
  return {
    rows,
    table: {
      get: (key: string) => rows.get(key),
      entries: () => rows.entries(),
      keys: () => rows.keys(),
      get size() {
        return rows.size
      },
      put: async (key: string, value: Value) => {
        rows.set(key, value)
      },
      delete: async (key: string) => rows.delete(key),
      update: async (key: string, change: (current: Value) => Value) => {
        const current = rows.get(key)
        if (current === undefined) throw new Error(`missing row ${key}`)
        const next = change(current)
        rows.set(key, next)
        return next
      },
    },
  }
}

const makeTables = () => {
  const agents = memoryTable<Agent>()
  const threads = memoryTable<AgentThread>()
  const tables = { agents: agents.table, threads: threads.table }
  return { agents: agents.rows, threads: threads.rows, tables }
}

describe('agents Effect Host bridge', () => {
  it('serves every existing API method from one scoped registry', async () => {
    const host = await createTestHost()
    const memory = makeTables()
    let closed = false
    host.ctx.provide('storageDomain', {
      open: async () => ({
        table: <Name extends keyof typeof memory.tables>(name: Name): (typeof memory.tables)[Name] => memory.tables[name],
        close: async () => {
          closed = true
        },
      }),
    })
    await mountPlugin(host, plugin, { packageId: '@dshfiles/agents' })
    const agents = createHostApiClient(host.ctx, agentsApi, '@dshfiles/agents')

    try {
      const initial = await agents.list()
      expect(initial.agents.map(agent => agent.handle)).toEqual(['dsh'])
      expect(await agents.presets()).toEqual({ presets: [] })

      const saved = await agents.save({ agent: draft })
      expect(saved.kind).toBe('applied')
      expect((await agents.get({ handle: 'reviewer' })).agent?.name).toBe('Reviewer')

      const used = await agents.recordUse({ handle: 'reviewer', thread: { sessionId: 'session-review', title: 'Review' } })
      expect(used.agents.find(agent => agent.handle === 'reviewer')?.threadCount).toBe(1)
      expect((await agents.threads({ handle: 'reviewer' })).threads).toMatchObject([{ sessionId: 'session-review', title: 'Review' }])
      expect((await agents.threadAgent({ sessionId: 'session-review' })).agent?.handle).toBe('reviewer')
      expect((await agents.remove({ handle: 'reviewer', confirm: true })).kind).toBe('applied')
      expect(await agents.get({ handle: 'reviewer' })).toEqual({ agent: null })
    } finally {
      await host.dispose()
    }

    expect(closed).toBe(true)
    expect(memory.agents.has('reviewer')).toBe(false)
    expect(memory.threads.has('session-review')).toBe(false)
  })
})
