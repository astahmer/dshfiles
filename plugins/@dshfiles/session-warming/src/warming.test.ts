import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionWarming, type WarmingSettings, type WarmResult } from './warming.js'

const settings = (overrides: Partial<WarmingSettings> = {}): WarmingSettings => ({
  enabled: true,
  intervalMinutes: 4,
  maxWarmupsPerIdle: 3,
  maxWarmupsPerHour: 30,
  providers: [],
  ...overrides,
})

const usage: WarmResult = { inputTokens: 12, cacheReadTokens: 5_000, cacheWriteTokens: 0, outputTokens: 1 }
const request = { provider: 'anthropic', model: 'claude', marker: 'prefix-1' }
type Request = typeof request
const minutes = (count: number) => count * 60_000

describe('SessionWarming.scheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = (current: WarmingSettings) => {
    const sent: { sessionId: string; request: Request }[] = []
    const scheduler = SessionWarming.scheduler<Request>({
      settings: () => current,
      now: () => Date.now(),
      warm: async (warmed, sessionId) => {
        sent.push({ sessionId, request: warmed })
        return usage
      },
    })
    return { scheduler, sent }
  }

  it('re-sends the last request each interval after a turn, up to the per-idle limit, then waits for the next turn', async () => {
    const { scheduler, sent } = setup(settings())
    scheduler.recordRequest('s1', request)
    scheduler.recordRequest('s1', { ...request, marker: 'prefix-2' })
    scheduler.turnEnded('s1')

    await vi.advanceTimersByTimeAsync(minutes(3))
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(minutes(1))
    expect(sent.map(entry => entry.request.marker)).toEqual(['prefix-2'])
    await vi.advanceTimersByTimeAsync(minutes(20))
    expect(sent).toHaveLength(3)
    expect(scheduler.status().sessions[0]).toMatchObject({ warmups: 3, stopped: 'idle-limit', last: usage, nextAt: null })

    scheduler.turnStarted('s1')
    await vi.advanceTimersByTimeAsync(minutes(20))
    expect(sent).toHaveLength(3)
    scheduler.recordRequest('s1', { ...request, marker: 'prefix-3' })
    scheduler.turnEnded('s1')
    await vi.advanceTimersByTimeAsync(minutes(4))
    expect(sent).toHaveLength(4)
  })

  it('never warms while disabled or for a provider outside the list', async () => {
    const off = setup(settings({ enabled: false }))
    off.scheduler.recordRequest('s1', request)
    off.scheduler.turnEnded('s1')
    const filtered = setup(settings({ providers: ['openai'] }))
    filtered.scheduler.recordRequest('s1', request)
    filtered.scheduler.turnEnded('s1')

    await vi.advanceTimersByTimeAsync(minutes(30))
    expect(off.sent).toEqual([])
    expect(filtered.sent).toEqual([])
    expect(off.scheduler.status().sessions[0]?.stopped).toBe('disabled')
  })

  it('shares one rolling hourly budget across threads', async () => {
    const { scheduler, sent } = setup(settings({ maxWarmupsPerHour: 2, maxWarmupsPerIdle: 5 }))
    for (const sessionId of ['s1', 's2']) {
      scheduler.recordRequest(sessionId, request)
      scheduler.turnEnded(sessionId)
    }
    await vi.advanceTimersByTimeAsync(minutes(8))
    expect(sent).toHaveLength(2)
    expect(scheduler.status()).toMatchObject({ warmupsLastHour: 2 })
    expect(scheduler.status().sessions.map(session => session.stopped)).toEqual(['hourly-limit', 'hourly-limit'])
  })

  it('stops a thread whose warm-up failed until its next turn', async () => {
    let fail = true
    const scheduler = SessionWarming.scheduler<Request>({
      settings: () => settings(),
      warm: async () => {
        if (fail) throw new Error('max_tokens must exceed the thinking budget')
        return usage
      },
    })
    scheduler.recordRequest('s1', request)
    scheduler.turnEnded('s1')
    await vi.advanceTimersByTimeAsync(minutes(12))
    expect(scheduler.status().sessions[0]).toMatchObject({ warmups: 1, stopped: 'failed', error: 'max_tokens must exceed the thinking budget' })

    fail = false
    scheduler.turnStarted('s1')
    scheduler.recordRequest('s1', request)
    scheduler.turnEnded('s1')
    await vi.advanceTimersByTimeAsync(minutes(4))
    expect(scheduler.status().sessions[0]).toMatchObject({ warmups: 1, stopped: null, error: null, last: usage })
  })

  it('drops a thread’s timer when its model changes or it is forgotten', async () => {
    const { scheduler, sent } = setup(settings())
    scheduler.recordRequest('s1', request)
    scheduler.turnEnded('s1')
    scheduler.recordRequest('s1', { ...request, model: 'other' })
    scheduler.recordRequest('s2', request)
    scheduler.turnEnded('s2')
    scheduler.forget('s2')
    await vi.advanceTimersByTimeAsync(minutes(10))
    expect(sent).toEqual([])
  })
})

describe('SessionWarming.warm', () => {
  it('re-sends the request for one output token and reports the cache reads in a span', async () => {
    using recorder = recordSpans()
    const sent: GenerateOptions[] = []
    const llm = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        sent.push(options)
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 1, cacheReadTokens: 9_000 } }
        yield { type: 'finish', reason: 'length' }
      },
    }
    const original: GenerateOptions = Object.freeze({ provider: 'anthropic', model: 'claude', messages: [], maxTokens: 8_000 })

    expect(await SessionWarming.warm(llm, original)).toEqual({ inputTokens: 20, outputTokens: 1, cacheReadTokens: 9_000, cacheWriteTokens: 0 })
    expect(sent[0]).toMatchObject({ provider: 'anthropic', model: 'claude', maxTokens: 1 })
    expect(sent[0]?.messages).toBe(original.messages)
    expect(recorder.span('session-warming warm').attributes['session_warming.cache_read_tokens']).toBe(9_000)
  })
})
