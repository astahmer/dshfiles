import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { RequestRow, SessionMeta } from './fold.js'
import { UsageRepo } from './store.js'
import { usageRepoTest } from './test-layers.js'

const row = (id: string, sessionId: string): RequestRow => ({
  id,
  sessionId,
  provider: 'Account',
  model: 'model',
  startedAt: 1_000,
  purpose: 'agent',
  source: 'log',
  seq: 1,
  messageId: null,
  turn: 1,
  step: 1,
  endedAt: 1_100,
  ttftMs: 10,
  usage: { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  status: 'ok',
  stopReason: null,
  errorCode: null,
})

const session = (id: string, parentSession: string | null): SessionMeta => ({
  id,
  cwd: '/dev/sample',
  parentSession,
  subagent: parentSession !== null,
  createdAt: 1,
  title: id,
})

const seedFamily = Effect.fn(function* () {
  const store = yield* UsageRepo
  const sessions: ReadonlyArray<readonly [SessionMeta, number]> = [
    [session('root', null), 1],
    [session('child', 'root'), 2],
    [session('grandchild', 'child'), 3],
    [session('unrelated', null), 4],
  ]
  for (const [meta, requests] of sessions) {
    yield* store.commitLogSlice({
      path: `/${meta.id}`,
      sessionId: meta.id,
      offset: 1,
      size: 1,
      mtimeMs: 1,
      state: '{}',
      session: meta,
      rows: Array.from({ length: requests }, (_, index) => row(`${meta.id}-${String(index)}`, meta.id)),
    })
  }
  yield* store.writeRates({
    replace: true,
    rates: new Map([['Account', { route: { provider: 'Account', model: 'model', band: 0 }, rates: { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0 } }]]),
  })
  return store
})

describe('usage family cost', () => {
  it.effect('totals a thread with its subagents and their subagents, but not unrelated threads', () =>
    Effect.gen(function* () {
      const store = yield* seedFamily()
      const cost = yield* store.familyCost({ sessionId: 'root' })
      expect(cost.own).toEqual({ cost: 1, requests: 1, tokens: 1_000, unpriced: 0 })
      expect(cost.family).toEqual({ cost: 6, requests: 6, tokens: 6_000, unpriced: 0 })
      expect(cost.members.map(member => [member.sessionId, member.depth, member.parentSessionId, member.cost])).toEqual([
        ['grandchild', 2, 'child', 3],
        ['child', 1, 'root', 2],
      ])
      expect(cost.omittedMembers).toBe(0)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('reads a subagent as the root of its own family', () =>
    Effect.gen(function* () {
      const store = yield* seedFamily()
      const cost = yield* store.familyCost({ sessionId: 'child' })
      expect(cost.own.cost).toBe(2)
      expect(cost.family.cost).toBe(5)
      expect(cost.members.map(member => member.sessionId)).toEqual(['grandchild'])
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('answers zero for a thread with no recorded requests', () =>
    Effect.gen(function* () {
      const store = yield* seedFamily()
      const cost = yield* store.familyCost({ sessionId: 'missing' })
      expect(cost.family).toEqual({ cost: 0, requests: 0, tokens: 0, unpriced: 0 })
      expect(cost.members).toEqual([])
    }).pipe(Effect.provide(usageRepoTest())),
  )
})
