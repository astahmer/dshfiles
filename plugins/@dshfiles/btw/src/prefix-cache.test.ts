import { describe, expect, it } from 'vitest'
import { PrefixCache, PrefixCacheReader } from './prefix-cache.js'

const assistant = (usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number }) => ({
  type: 'assistant/message',
  data: { turn: 1, step: 1, usage },
})

const seed = { type: 'session/end-seed', data: {} }
const liveChunk = { type: 'assistant/live-chunk', data: {} }

const windowOf = (events: readonly unknown[], kind = 'replace') => ({ entries: events.map(event => ({ event })), change: { kind } })

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

describe('PrefixCacheReader', () => {
  it('agrees with the pure scan on every tick of a log that keeps appending', () => {
    const reader = new PrefixCacheReader()
    const ticks = [
      { events: [seed], kind: 'replace' },
      { events: [seed, liveChunk], kind: 'append' },
      { events: [seed, liveChunk, assistant({ inputTokens: 300, outputTokens: 40, cacheReadTokens: 8700 })], kind: 'append' },
      {
        events: [seed, liveChunk, assistant({ inputTokens: 300, outputTokens: 40, cacheReadTokens: 8700 }), assistant({ inputTokens: 5, outputTokens: 1 })],
        kind: 'append',
      },
    ]
    for (const tick of ticks) expect(reader.read(windowOf(tick.events, tick.kind))).toEqual(PrefixCache.firstRequestAfterFork(tick.events))
  })

  it('rescans a tail the source rewrote instead of appending to it', () => {
    const reader = new PrefixCacheReader()
    expect(reader.read(windowOf([seed, liveChunk]))).toBeUndefined()
    const settled = [seed, assistant({ inputTokens: 11, outputTokens: 2 })]
    expect(reader.read(windowOf(settled, 'settle-assistant'))).toEqual(PrefixCache.firstRequestAfterFork(settled))
    expect(reader.read(windowOf(settled, 'settle-assistant'))?.inputTokens).toBe(11)
  })

  it('keeps the resolved reading while the log keeps growing', () => {
    const reader = new PrefixCacheReader()
    const resolved = [seed, assistant({ inputTokens: 300, outputTokens: 40, cacheReadTokens: 8700 })]
    const first = reader.read(windowOf(resolved))
    expect(first?.inputTokens).toBe(300)
    const grown = [...resolved, liveChunk, assistant({ inputTokens: 5, outputTokens: 1 })]
    expect(reader.read(windowOf(grown, 'append'))).toBe(first)
    expect(PrefixCache.firstRequestAfterFork(grown)).toEqual(first)
  })
})
