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
})
