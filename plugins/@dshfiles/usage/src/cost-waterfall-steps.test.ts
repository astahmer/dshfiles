import { describe, expect, it } from 'vitest'
import type { RequestView } from './api.js'
import { ThreadCostWaterfall } from './cost-waterfall-steps.js'

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
  cacheRead: 2,
  cacheWrite: 3,
  output: 5,
  cost: 0.01,
  status: 'ok',
  stopReason: null,
  errorCode: null,
  ...patch,
})

describe('ThreadCostWaterfall.stepsOf', () => {
  it('groups requests per turn, oldest turn first, requests in start order, side requests last', () => {
    const { steps, hiddenTurns } = ThreadCostWaterfall.stepsOf([
      row({ id: 'c', turn: 2, startedAt: 5_000, durationMs: 1_000 }),
      row({ id: 'd', turn: null, purpose: 'title', startedAt: 1_500, durationMs: 500 }),
      row({ id: 'b', turn: 2, startedAt: 3_000, durationMs: 1_500 }),
      row({ id: 'a', turn: 1, startedAt: 1_000, durationMs: 2_000 }),
    ])
    expect(hiddenTurns).toBe(0)
    expect(steps.map(step => [step.id, step.parentId])).toEqual([
      ['turn-1', undefined],
      ['a', 'turn-1'],
      ['turn-2', undefined],
      ['b', 'turn-2'],
      ['c', 'turn-2'],
      ['side', undefined],
      ['d', 'side'],
    ])
    expect(steps.find(step => step.id === 'a')).toMatchObject({
      name: 'agent',
      detail: 'gpt-6-luna',
      start: 0,
      end: 2,
      inputTokens: 15,
      outputTokens: 5,
      cost: 0.01,
    })
    expect(steps.find(step => step.id === 'turn-2')).toMatchObject({ start: 2, end: 5 })
    expect(steps.find(step => step.id === 'side')).toMatchObject({ name: 'Side requests · 1 request', start: 0.5, end: 1 })
  })

  it('never labels a group with a bare "Turn n", which the Per turn table owns', () => {
    const { steps } = ThreadCostWaterfall.stepsOf([row({ id: 'a', turn: 3 }), row({ id: 'b', turn: 3 })])
    expect(steps[0]?.name).toBe('Turn 3 · 2 requests')
    expect(steps.some(step => /^Turn \d+$/.test(step.name))).toBe(false)
  })

  it('marks failed requests with their error code and leaves unknown costs undefined', () => {
    const { steps } = ThreadCostWaterfall.stepsOf([
      row({ id: 'ok', errorCode: 'ignored' }),
      row({ id: 'failed', status: 'failed', errorCode: 'rate_limited', cost: null, durationMs: null, input: null, output: null }),
    ])
    expect(steps.find(step => step.id === 'ok')?.error).toBeUndefined()
    expect(steps.find(step => step.id === 'failed')).toMatchObject({
      error: 'rate_limited',
      cost: undefined,
      inputTokens: 5,
      outputTokens: 0,
      start: 0,
      end: 0,
    })
  })

  it('keeps only the most recent turns and reports how many it left out', () => {
    const rows = [1, 2, 3, 4].map(turn => row({ id: `r${String(turn)}`, turn, startedAt: turn * 1_000 }))
    const { steps, hiddenTurns } = ThreadCostWaterfall.stepsOf([...rows, row({ id: 'side-1', turn: null, startedAt: 500 })], 2)
    expect(hiddenTurns).toBe(2)
    expect(steps.filter(step => step.parentId === undefined).map(step => step.id)).toEqual(['turn-3', 'turn-4', 'side'])
    // Times start at the earliest drawn request.
    expect(steps.find(step => step.id === 'side-1')?.start).toBe(0)
    expect(steps.find(step => step.id === 'r3')?.start).toBe(2.5)
  })
})
