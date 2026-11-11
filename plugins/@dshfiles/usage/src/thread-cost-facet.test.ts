import { describe, expect, it } from 'vitest'
import type { RequestView } from './api.js'
import { ThreadCost } from './thread-cost-facet.js'

const row = (patch: Partial<RequestView>): RequestView => ({
  id: 'r',
  sessionId: 'session-1',
  sessionTitle: 'Thread',
  parentSessionId: null,
  project: null,
  cwd: null,
  seq: null,
  messageId: null,
  turn: 1,
  step: null,
  purpose: 'agent',
  provider: 'commandcode_work',
  model: 'gpt-6-luna',
  startedAt: 0,
  durationMs: null,
  ttftMs: null,
  input: 10,
  cacheRead: 0,
  cacheWrite: 0,
  output: 5,
  cost: 0.01,
  status: 'ok',
  stopReason: null,
  errorCode: null,
  ...patch,
})

describe('ThreadCost', () => {
  it('folds a thread’s requests per turn, newest turn first, side requests last', () => {
    const turns = ThreadCost.turnsOf([
      row({ id: 'a', turn: 1, cost: 0.01 }),
      row({ id: 'b', turn: 2, cost: 0.02, model: 'gpt-6-luna-mini' }),
      row({ id: 'c', turn: 2, cost: null, status: 'failed' }),
      row({ id: 'd', turn: null, cost: 0.001, purpose: 'title' }),
    ])
    expect(turns.map(turn => turn.turn)).toEqual([2, 1, null])
    expect(turns[0]).toMatchObject({ requests: 2, cost: 0.02, tokens: 30, failed: 1, models: ['gpt-6-luna', 'gpt-6-luna-mini'] })
    expect(turns[2]).toMatchObject({ requests: 1, cost: 0.001 })
  })

  it('keeps an unpriced turn unknown instead of zero', () => {
    expect(ThreadCost.turnsOf([row({ cost: null })])[0]?.cost).toBeNull()
  })

  const totals = (cost: number, requests: number) => ({ cost, requests, tokens: 0, unpriced: 0 })
  const family = (members: number) => ({
    sessionId: 'root',
    own: totals(1, 2),
    family: totals(5, 9),
    members: Array.from({ length: members }, (_, index) => ({
      sessionId: `child-${String(index)}`,
      title: null,
      parentSessionId: 'root',
      depth: 1,
      ...totals(4, 7),
    })),
    omittedMembers: 0,
  })
  const own = { cost: 1, requests: 2 }

  it('heads the facet with the family total when the thread has subagents', () => {
    expect(ThreadCost.headlineOf({ scope: 'family', family: family(1), own })).toEqual({ cost: 5, requests: 9, scope: 'family' })
    expect(ThreadCost.headlineOf({ scope: 'own', family: family(1), own })).toEqual({ cost: 1, requests: 2, scope: 'own' })
  })

  it('falls back to the thread total without subagents or on a Host without family cost', () => {
    expect(ThreadCost.headlineOf({ scope: 'family', family: family(0), own })).toEqual({ cost: 1, requests: 2, scope: 'own' })
    expect(ThreadCost.headlineOf({ scope: 'family', family: undefined, own })).toEqual({ cost: 1, requests: 2, scope: 'own' })
  })
})
