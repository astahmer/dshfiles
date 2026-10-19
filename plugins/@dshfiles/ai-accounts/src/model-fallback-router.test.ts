import { describe, expect, it } from 'vitest'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Distribution } from './account-pool.js'
import type { FallbackRoute } from './model-fallback-api.js'
import { createModelFallbackRouter } from './model-fallback-router.js'
import { createModelFallbackStore, type ModelFallbackStore } from './model-fallback-store.js'

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

const codex = { provider: 'codex-work', model: 'gpt-6', reasoningEffort: 'high' }
const claude = { provider: 'claude-work', model: 'claude-opus-5-5', reasoningEffort: 'medium' }
const opencode = { provider: 'opencode-go', model: 'glm-5.3' }

const setup = async (options: { readonly distribution?: Distribution; readonly store?: ModelFallbackStore } = {}) => {
  const store =
    options.store ?? createModelFallbackStore({ tables: { chains: memoryTable(), active: memoryTable(), preferences: memoryTable() }, now: () => 1_000 })
  if (options.store === undefined) await store.setChain({ chain: [claude, opencode] })
  const unavailable: string[] = []
  const router = createModelFallbackRouter({
    store: () => store,
    distribution: () => options.distribution ?? 'priority',
    available: (route: FallbackRoute) => !unavailable.includes(route.provider),
    onError: message => {
      throw new Error(message)
    },
  })
  const failOver = (input: { readonly turn: number; readonly from: typeof codex | typeof claude }) => {
    const candidates = router.candidates({ sessionId: 'thread', current: input.from, now: 1_000 })
    const to = candidates?.[0]
    if (to !== undefined) router.bind({ sessionId: 'thread', to })
    return candidates
  }
  return { store, router, unavailable, failOver }
}

describe('model fallback router', () => {
  it('leaves threads alone outside Priority or without a chain', async () => {
    const { router } = await setup({ distribution: 'sticky' })
    expect(router.candidates({ sessionId: 'thread', current: codex, now: 1_000 })).toBeUndefined()
    expect(router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })).toBeUndefined()
  })

  it('puts the fallback on a retry that still proposes the failed route and stays there by default', async () => {
    const { router, failOver } = await setup()
    expect(router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })).toBeUndefined()
    expect(failOver({ turn: 1, from: codex })).toEqual(['claude-work/claude-opus-5-5', 'opencode-go/glm-5.3'])

    expect(router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })).toEqual(claude)
    expect(router.routeRequest({ sessionId: 'thread', turn: 1, request: claude })).toBeUndefined()
    expect(router.turnEnded('thread')).toBeUndefined()
    expect(router.routeRequest({ sessionId: 'thread', turn: 2, request: claude })).toBeUndefined()
    expect(router.active('thread')).toEqual(claude)
  })

  it('never tries the same route twice in one turn and walks on from the fallback', async () => {
    const { router, failOver } = await setup()
    router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })
    failOver({ turn: 1, from: codex })
    router.routeRequest({ sessionId: 'thread', turn: 1, request: claude })
    expect(failOver({ turn: 1, from: claude })).toEqual(['opencode-go/glm-5.3'])
    expect(router.routeRequest({ sessionId: 'thread', turn: 1, request: claude })).toEqual(opencode)
    expect(router.returnToSelection('thread')).toEqual(codex)
  })

  it('hands the selection back at the end of the turn under the next-turn policy', async () => {
    const { store, router, failOver } = await setup()
    await store.setReturnPolicy('next-turn')
    router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })
    failOver({ turn: 1, from: codex })

    expect(router.turnEnded('thread')).toEqual(codex)
    expect(router.active('thread')).toBeUndefined()
    expect(router.turnEnded('thread')).toBeUndefined()
  })

  it('hands the selection back when asked and forgets the fallback when the user picks another model', async () => {
    const asked = await setup()
    asked.router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })
    asked.failOver({ turn: 1, from: codex })
    expect(asked.router.returnToSelection('thread')).toEqual(codex)
    expect(asked.router.active('thread')).toBeUndefined()

    const picked = await setup()
    picked.router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })
    picked.failOver({ turn: 1, from: codex })
    expect(picked.router.routeRequest({ sessionId: 'thread', turn: 2, request: opencode })).toBeUndefined()
    expect(picked.router.active('thread')).toBeUndefined()

    const repicked = await setup()
    repicked.router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })
    repicked.failOver({ turn: 1, from: codex })
    expect(repicked.router.routeRequest({ sessionId: 'thread', turn: 2, request: codex })).toBeUndefined()
    expect(repicked.router.active('thread')).toBeUndefined()
  })

  it('keeps a fallback across a Host restart', async () => {
    const first = await setup()
    first.router.routeRequest({ sessionId: 'thread', turn: 1, request: codex })
    first.failOver({ turn: 1, from: codex })

    const restarted = await setup({ store: first.store })
    expect(restarted.router.active('thread')).toEqual(claude)
    expect(restarted.router.routeRequest({ sessionId: 'thread', turn: 3, request: claude })).toBeUndefined()
    expect(restarted.router.active('thread')).toEqual(claude)
  })
})
