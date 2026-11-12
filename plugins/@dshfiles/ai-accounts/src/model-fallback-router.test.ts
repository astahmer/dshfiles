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
    deleteMany: async keys => keys.filter(key => rows.delete(key)).length,
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

const setup = async (options: { readonly distribution?: Distribution; readonly store?: ModelFallbackStore; readonly stalledStreamFallback?: boolean } = {}) => {
  const store =
    options.store ?? createModelFallbackStore({ tables: { chains: memoryTable(), active: memoryTable(), preferences: memoryTable() }, now: () => 1_000 })
  if (options.store === undefined) await store.setChain({ chain: [claude, opencode] })
  const unavailable: string[] = []
  const router = createModelFallbackRouter({
    store: () => store,
    distribution: () => options.distribution ?? 'priority',
    available: (route: FallbackRoute) => !unavailable.includes(route.provider),
    stalledStreamFallback: () => options.stalledStreamFallback ?? false,
    onError: message => {
      throw new Error(message)
    },
  })
  const failOver = (input: { readonly from: FallbackRoute }) => {
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
    router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    expect(router.candidates({ sessionId: 'thread', current: codex, now: 1_000 })).toBeUndefined()
    expect(router.active('thread')).toBeUndefined()
  })

  it('keeps a stalled stream off the chain outside Priority unless stalled-stream fallback is on', async () => {
    const { router } = await setup({ distribution: 'sticky' })
    router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    expect(router.candidates({ sessionId: 'thread', current: codex, now: 1_000, stalled: true })).toBeUndefined()
  })

  it('walks the stored chain for a stalled stream under Sticky when stalled-stream fallback is on', async () => {
    const { router } = await setup({ distribution: 'sticky', stalledStreamFallback: true })
    router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    expect(router.candidates({ sessionId: 'thread', current: codex, now: 1_000 })).toBeUndefined()
    expect(router.candidates({ sessionId: 'thread', current: codex, now: 1_000, stalled: true })).toEqual([
      'claude-work/claude-opus-5-5',
      'opencode-go/glm-5.3',
    ])
    expect(router.bind({ sessionId: 'thread', to: 'claude-work/claude-opus-5-5' })).toEqual(claude)
    expect(router.active('thread')).toEqual(claude)
  })

  it('stands on the fallback the next step selects and stays there by default', async () => {
    const { router, failOver } = await setup()
    router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    expect(failOver({ from: codex })).toEqual(['claude-work/claude-opus-5-5', 'opencode-go/glm-5.3'])
    expect(router.active('thread')).toEqual(claude)

    router.observeRequest({ sessionId: 'thread', turn: 2, request: claude })
    expect(router.turnEnded('thread')).toBeUndefined()
    router.observeRequest({ sessionId: 'thread', turn: 3, request: claude })
    expect(router.active('thread')).toEqual(claude)
  })

  it('walks on from the routes a continued turn already tried instead of wrapping back', async () => {
    const { router, failOver } = await setup()
    router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    failOver({ from: codex })
    router.continueTurn({ sessionId: 'thread', turn: 2 })
    router.observeRequest({ sessionId: 'thread', turn: 2, request: claude })
    expect(failOver({ from: claude })).toEqual(['opencode-go/glm-5.3'])
    router.continueTurn({ sessionId: 'thread', turn: 3 })
    router.observeRequest({ sessionId: 'thread', turn: 3, request: opencode })
    expect(router.candidates({ sessionId: 'thread', current: opencode, now: 1_000 })).toEqual([])
    expect(router.returnToSelection('thread')).toEqual(codex)
  })

  it('starts a fresh walk in a turn that does not continue a fail-over', async () => {
    const { router, failOver } = await setup()
    router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    failOver({ from: codex })
    router.observeRequest({ sessionId: 'thread', turn: 2, request: claude })
    failOver({ from: claude })
    router.observeRequest({ sessionId: 'thread', turn: 3, request: opencode })
    expect(router.candidates({ sessionId: 'thread', current: opencode, now: 1_000 })).toEqual(['claude-work/claude-opus-5-5'])
  })

  it('hands the selection back at the end of the turn under the next-turn policy', async () => {
    const { store, router, failOver } = await setup()
    await store.setReturnPolicy('next-turn')
    router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    failOver({ from: codex })

    expect(router.turnEnded('thread')).toEqual(codex)
    expect(router.active('thread')).toBeUndefined()
    expect(router.turnEnded('thread')).toBeUndefined()
  })

  it('hands the selection back when asked and forgets the fallback when a request names another route', async () => {
    const asked = await setup()
    asked.router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    asked.failOver({ from: codex })
    expect(asked.router.returnToSelection('thread')).toEqual(codex)
    expect(asked.router.active('thread')).toBeUndefined()

    const picked = await setup()
    picked.router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    picked.failOver({ from: codex })
    picked.router.observeRequest({ sessionId: 'thread', turn: 2, request: opencode })
    expect(picked.router.active('thread')).toBeUndefined()

    const repicked = await setup()
    repicked.router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    repicked.failOver({ from: codex })
    repicked.router.observeRequest({ sessionId: 'thread', turn: 2, request: codex })
    expect(repicked.router.active('thread')).toBeUndefined()
  })

  it('keeps a fallback across a Host restart', async () => {
    const first = await setup()
    first.router.observeRequest({ sessionId: 'thread', turn: 1, request: codex })
    first.failOver({ from: codex })

    const restarted = await setup({ store: first.store })
    expect(restarted.router.active('thread')).toEqual(claude)
    restarted.router.observeRequest({ sessionId: 'thread', turn: 3, request: claude })
    expect(restarted.router.active('thread')).toEqual(claude)
  })
})

describe('per-provider family chain', () => {
  const familyRouter = (
    options: {
      readonly distribution?: Distribution
      readonly siblings?: (input: { readonly provider: string; readonly model: string | undefined }) => readonly FallbackRoute[] | undefined
    } = {},
  ) => {
    const store = createModelFallbackStore({
      tables: { chains: memoryTable(), active: memoryTable(), preferences: memoryTable() },
      now: () => 1_000,
    })
    const router = createModelFallbackRouter({
      store: () => store,
      distribution: () => options.distribution ?? 'priority',
      available: () => true,
      siblings: options.siblings ?? (() => undefined),
      onError: message => {
        throw new Error(message)
      },
    })
    return { router, store }
  }

  const codexFamily = ({ provider, model }: { readonly provider: string; readonly model: string | undefined }) =>
    provider.startsWith('codex') && model !== undefined
      ? [
          { provider: 'codex-alex2', model },
          { provider: 'opencode-go-alex', model },
        ]
      : undefined

  it('walks one rung per sibling account when the thread has no stored chain', () => {
    const { router } = familyRouter({ siblings: codexFamily })
    const from = { provider: 'codex-emialex', model: 'gpt-6' }

    router.observeRequest({ sessionId: 'thread', turn: 1, request: from })
    expect(router.candidates({ sessionId: 'thread', current: from, now: 1_000 })).toEqual(['codex-alex2/gpt-6', 'opencode-go-alex/gpt-6'])

    router.bind({ sessionId: 'thread', to: 'codex-alex2/gpt-6' })
    expect(router.active('thread')).toEqual({ provider: 'codex-alex2', model: 'gpt-6' })
    router.observeRequest({ sessionId: 'thread', turn: 2, request: { provider: 'codex-alex2', model: 'gpt-6' } })
    expect(router.active('thread')).toEqual({ provider: 'codex-alex2', model: 'gpt-6' })
  })

  it('leaves Sticky threads and kinds without siblings on account fail-over', () => {
    const sticky = familyRouter({ distribution: 'sticky', siblings: codexFamily })
    expect(sticky.router.candidates({ sessionId: 'thread', current: { provider: 'codex-emialex', model: 'gpt-6' }, now: 1_000 })).toBeUndefined()

    const claude = familyRouter({
      siblings: ({ provider, model }) => (provider === 'claude_work' ? undefined : model === undefined ? undefined : codexFamily({ provider, model })),
    })
    expect(claude.router.candidates({ sessionId: 'thread', current: { provider: 'claude_work', model: 'claude-opus-5-5' }, now: 1_000 })).toBeUndefined()
  })

  it('keeps a stored chain ahead of the derived family chain', async () => {
    const { router, store } = familyRouter({ siblings: codexFamily })
    await store.setChain({ sessionId: 'thread', chain: [{ provider: 'deepseek', model: 'deepseek-chat' }] })

    expect(router.candidates({ sessionId: 'thread', current: { provider: 'codex-emialex', model: 'gpt-6' }, now: 1_000 })).toEqual(['deepseek/deepseek-chat'])
  })
})
