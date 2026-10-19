import { describe, expect, it } from 'vitest'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { createModelFallbackStore } from './model-fallback-store.js'

const memoryTable = <Value>(): KvTable<string, Value> => {
  const rows = new Map<string, Value>()
  return {
    get: key => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key, value) => {
      rows.set(key, value)
    },
    delete: async key => rows.delete(key),
    update: async (key, change) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing row')
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
}

const createStore = () => createModelFallbackStore({ tables: { chains: memoryTable(), active: memoryTable(), preferences: memoryTable() }, now: () => 1_000 })

const claude = { provider: 'claude-work', model: 'claude-opus-5-5' }
const opencode = { provider: 'opencode-go', model: 'glm-5.3', reasoningEffort: 'high' }

describe('model fallback store', () => {
  it('lets a thread override the default chain and drop the override again', async () => {
    const store = createStore()
    await store.setChain({ chain: [claude, opencode] })
    await store.setChain({ sessionId: 'session-a', chain: [opencode] })

    expect(store.chainFor('session-a')).toEqual([opencode])
    expect(store.chainFor('session-b')).toEqual([claude, opencode])

    await store.setChain({ sessionId: 'session-a', chain: null })
    expect(store.chainFor('session-a')).toEqual([claude, opencode])
    expect(store.snapshot({ sessionId: 'session-a', distribution: 'priority' })).toEqual({
      distribution: 'priority',
      returnPolicy: 'stay',
      defaultChain: [claude, opencode],
      threadChain: null,
      active: null,
    })
  })

  it('remembers which fallback serves a thread until it returns to its selection', async () => {
    const store = createStore()
    await store.activate('session-a', { route: claude, from: opencode })
    expect(store.activeFor('session-a')).toEqual({ route: claude, from: opencode })
    expect(store.snapshot({ sessionId: 'session-a', distribution: 'priority' }).active).toEqual(claude)

    await store.deactivate('session-a')
    expect(store.activeFor('session-a')).toBeUndefined()
  })

  it('stores the return policy once for every thread', async () => {
    const store = createStore()
    await store.setReturnPolicy('next-turn')
    expect(store.snapshot({ distribution: 'sticky' }).returnPolicy).toBe('next-turn')
  })
})
