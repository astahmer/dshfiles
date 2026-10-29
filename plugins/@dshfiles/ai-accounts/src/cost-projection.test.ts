import { describe, expect, it } from 'vitest'
import { CostProjectionModel } from './cost-projection.js'

const header = (provider: string, model: string) => ({ type: 'request/header', data: { header: { config: { provider, model } }, reason: 'change' } })
const message = (turn: number, step: number, usage: Record<string, number>) => ({
  type: 'assistant/message',
  data: { turn, step, message: {}, stream: [], usage },
})
const fold = (events: readonly { readonly type: string; readonly data?: unknown }[]) =>
  events.reduce(CostProjectionModel.applyEvent, CostProjectionModel.initialState())

describe('applyCostEvent', () => {
  it('groups usage by the route that served each request', () => {
    const state = fold([
      header('codex-emialex', 'gpt-6-luna'),
      message(0, 0, { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 9_000 }),
      message(0, 1, { inputTokens: 500, outputTokens: 100 }),
      { type: 'request/context', data: { provider: 'claude_work', model: 'claude-opus-5-5' } },
      message(1, 0, { inputTokens: 300_000, outputTokens: 10, cacheWriteTokens: 50 }),
    ])
    expect(state.view.groups).toEqual([
      {
        provider: 'codex-emialex',
        model: 'gpt-6-luna',
        band: 0,
        requests: 2,
        tokens: { uncachedInputTokens: 1_500, outputTokens: 300, cacheReadTokens: 9_000, cacheWriteTokens: 0 },
      },
      {
        provider: 'claude_work',
        model: 'claude-opus-5-5',
        band: 272_000,
        requests: 1,
        tokens: { uncachedInputTokens: 300_000, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 50 },
      },
    ])
    expect(state.view.turn?.turn).toBe(1)
    expect(state.view.turn?.groups.map(group => group.model)).toEqual(['claude-opus-5-5'])
    expect(state.view.turns?.map(entry => [entry.turn, entry.groups.map(group => group.model)])).toEqual([
      [0, ['gpt-6-luna']],
      [1, ['claude-opus-5-5']],
    ])
  })

  it('replaces a turn sample without losing earlier turn groups', () => {
    const state = fold([
      header('codex', 'gpt-6-luna'),
      message(0, 0, { inputTokens: 100, outputTokens: 20 }),
      message(1, 0, { inputTokens: 10, outputTokens: 1 }),
      message(1, 0, { inputTokens: 200, outputTokens: 40 }),
    ])
    expect(state.view.turns?.map(entry => [entry.turn, entry.groups[0]?.tokens.uncachedInputTokens])).toEqual([
      [0, 100],
      [1, 200],
    ])
  })

  it('replaces a failed attempt with the settled message of the same step', () => {
    const state = fold([
      header('codex', 'gpt-6-luna'),
      {
        type: 'assistant/attempt',
        data: { turn: 0, step: 0, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } } }] },
      },
      message(0, 0, { inputTokens: 100, outputTokens: 20 }),
    ])
    expect(state.view.groups).toHaveLength(1)
    expect(state.view.groups[0]?.requests).toBe(1)
    expect(state.view.groups[0]?.tokens.uncachedInputTokens).toBe(100)
  })

  it('adds a retried attempt after llm/retry-started', () => {
    const state = fold([
      header('codex', 'gpt-6-luna'),
      {
        type: 'assistant/attempt',
        data: { turn: 0, step: 0, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } } }] },
      },
      { type: 'llm/retry-started', data: { turn: 0, step: 0 } },
      message(0, 0, { inputTokens: 100, outputTokens: 20 }),
    ])
    expect(state.view.groups[0]?.requests).toBe(2)
    expect(state.view.groups[0]?.tokens.uncachedInputTokens).toBe(110)
  })

  it('keeps the view reference when only the route selection changes', () => {
    const before = fold([header('codex', 'gpt-6-luna'), message(0, 0, { inputTokens: 1, outputTokens: 1 })])
    const after = CostProjectionModel.applyEvent(before, header('claude', 'claude-opus-5-5'))
    expect(after).not.toBe(before)
    expect(after.view).toBe(before.view)
  })

  it('ignores events it does not price and samples without usage', () => {
    const state = fold([header('codex', 'gpt-6-luna')])
    expect(CostProjectionModel.applyEvent(state, { type: 'tool/call', data: {} })).toBe(state)
    expect(CostProjectionModel.applyEvent(state, { type: 'assistant/message', data: { turn: 0, step: 0, message: {}, stream: [] } })).toBe(state)
  })
})
