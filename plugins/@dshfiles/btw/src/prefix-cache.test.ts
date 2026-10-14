import { describe, expect, it } from 'vitest'
import { PrefixCache } from './prefix-cache.js'

const assistant = (usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number }) => ({
  type: 'assistant/message',
  data: { turn: 1, step: 1, usage },
})

describe('PrefixCache.firstRequestAfterFork', () => {
  it('reads the first request after the fork seed, not the copied source requests', () => {
    const reading = PrefixCache.firstRequestAfterFork([
      assistant({ inputTokens: 9000, outputTokens: 10 }),
      { type: 'session/end-seed', data: {} },
      { type: 'user/message', data: {} },
      assistant({ inputTokens: 300, outputTokens: 40, cacheReadTokens: 8700 }),
      assistant({ inputTokens: 5, outputTokens: 1, cacheReadTokens: 1 }),
    ])
    expect(reading).toEqual({ inputTokens: 300, cacheReadTokens: 8700, cacheWriteTokens: 0, cacheReadShare: 0.9666666666666667 })
  })

  it('falls back to the usage chunk of the stream, and waits while no request has answered', () => {
    expect(PrefixCache.firstRequestAfterFork([{ type: 'session/end-seed', data: {} }])).toBeUndefined()
    const reading = PrefixCache.firstRequestAfterFork([
      { type: 'session/end-seed', data: {} },
      {
        type: 'assistant/message',
        data: {
          stream: [
            { chunk: { type: 'text' } },
            { chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 900 } } },
          ],
        },
      },
    ])
    expect(reading?.cacheReadShare).toBe(0)
    expect(reading?.cacheWriteTokens).toBe(900)
  })
})
