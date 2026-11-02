import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Duration, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
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
const request: GenerateOptions = { provider: 'anthropic', model: 'claude', messages: [], maxTokens: 8_000 }
describe('SessionWarming scheduler', () => {
  it('re-sends the last request each interval after a turn, up to the per-idle limit, then waits for the next turn', async () => {
    const sent: GenerateOptions[] = []
    const activeLlm = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        sent.push(options)
        yield { type: 'usage', usage }
      },
    }
    const effect = Effect.scoped(
      Effect.gen(function* () {
        const active = yield* SessionWarming
        yield* active.handle({ kind: 'request', sessionId: 's1', request })
        yield* active.handle({ kind: 'turn-end', sessionId: 's1' })
        for (let index = 0; index < 3; index += 1) {
          yield* TestClock.adjust(Duration.minutes(4))
          yield* Effect.yieldNow
        }
        expect(sent).toHaveLength(3)
        expect((yield* active.status()).sessions[0]).toMatchObject({ warmups: 3, stopped: 'idle-limit', last: usage, nextAt: null })
      }).pipe(Effect.provide(Layer.merge(SessionWarming.layer({ settings, llm: activeLlm }), TestClock.layer()))),
    )
    await Effect.runPromise(effect)
  })

  it('never warms while disabled or for a provider outside the list', async () => {
    const sent: GenerateOptions[] = []
    const activeLlm = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        sent.push(options)
        yield { type: 'finish', reason: 'length' }
      },
    }
    const verifySetting = (current: WarmingSettings) =>
      Effect.scoped(
        Effect.gen(function* () {
          const active = yield* SessionWarming
          yield* active.handle({ kind: 'request', sessionId: 's1', request })
          yield* active.handle({ kind: 'turn-end', sessionId: 's1' })
          yield* TestClock.adjust(Duration.minutes(30))
          expect(sent).toEqual([])
        }).pipe(Effect.provide(Layer.merge(SessionWarming.layer({ settings: () => current, llm: activeLlm }), TestClock.layer()))),
      )
    await Effect.runPromise(verifySetting(settings({ enabled: false })))
    await Effect.runPromise(verifySetting(settings({ providers: ['openai'] })))
  })

  it('stops a thread whose warm-up failed until its next turn', async () => {
    const activeLlm = {
      async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        yield { type: 'usage', usage }
        throw new Error('max_tokens must exceed the thinking budget')
      },
    }
    const effect = Effect.scoped(
      Effect.gen(function* () {
        const active = yield* SessionWarming
        yield* active.handle({ kind: 'request', sessionId: 's1', request })
        yield* active.handle({ kind: 'turn-end', sessionId: 's1' })
        yield* TestClock.adjust(Duration.minutes(4))
        expect((yield* active.status()).sessions[0]).toMatchObject({ warmups: 1, stopped: 'failed', error: 'max_tokens must exceed the thinking budget' })
      }).pipe(Effect.provide(Layer.merge(SessionWarming.layer({ settings, llm: activeLlm }), TestClock.layer()))),
    )
    await Effect.runPromise(effect)
  })

  it('shares one rolling hourly budget across threads', async () => {
    const sent: string[] = []
    const activeLlm = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        sent.push(options.model)
        yield { type: 'usage', usage }
      },
    }
    const effect = Effect.scoped(
      Effect.gen(function* () {
        const active = yield* SessionWarming
        for (const sessionId of ['s1', 's2']) {
          yield* active.handle({ kind: 'request', sessionId, request })
          yield* active.handle({ kind: 'turn-end', sessionId })
        }
        yield* TestClock.adjust(Duration.minutes(4))
        yield* Effect.yieldNow
        yield* TestClock.adjust(Duration.minutes(4))
        yield* Effect.yieldNow
        expect(sent).toHaveLength(2)
        expect((yield* active.status()).sessions.map(session => session.stopped)).toEqual(['hourly-limit', 'hourly-limit'])
      }).pipe(
        Effect.provide(
          Layer.merge(SessionWarming.layer({ settings: () => settings({ maxWarmupsPerHour: 2, maxWarmupsPerIdle: 5 }), llm: activeLlm }), TestClock.layer()),
        ),
      ),
    )
    await Effect.runPromise(effect)
  })

  it('drops a thread’s timer when its model changes or it is forgotten', async () => {
    const sent: GenerateOptions[] = []
    const activeLlm = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        sent.push(options)
        yield { type: 'usage', usage }
      },
    }
    const effect = Effect.scoped(
      Effect.gen(function* () {
        const active = yield* SessionWarming
        yield* active.handle({ kind: 'request', sessionId: 's1', request })
        yield* active.handle({ kind: 'turn-end', sessionId: 's1' })
        yield* active.handle({ kind: 'request', sessionId: 's1', request: { ...request, model: 'other' } })
        yield* active.handle({ kind: 'request', sessionId: 's2', request })
        yield* active.handle({ kind: 'turn-end', sessionId: 's2' })
        yield* active.handle({ kind: 'forget', sessionId: 's2' })
        yield* TestClock.adjust(Duration.minutes(10))
        expect(sent).toEqual([])
      }).pipe(Effect.provide(Layer.merge(SessionWarming.layer({ settings, llm: activeLlm }), TestClock.layer()))),
    )
    await Effect.runPromise(effect)
  })
})

describe('SessionWarming.warm', () => {
  it('re-sends the request for one output token and reports the cache reads in a span', async () => {
    using recorder = recordSpans()
    const sent: GenerateOptions[] = []
    const activeLlm = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        sent.push(options)
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 1, cacheReadTokens: 9_000 } }
        yield { type: 'finish', reason: 'length' }
      },
    }
    const effect = SessionWarming.warm({ llm: activeLlm, request }).pipe(Effect.provide(DshxEffect.tracerLayer))

    expect(await Effect.runPromise(effect)).toEqual({ inputTokens: 20, outputTokens: 1, cacheReadTokens: 9_000, cacheWriteTokens: 0 })
    expect(sent[0]).toMatchObject({ provider: 'anthropic', model: 'claude', maxTokens: 1 })
    expect(sent[0]?.messages).toBe(request.messages)
    expect(recorder.span('session-warming warm').attributes['session_warming.cache_read_tokens']).toBe(9_000)
  })
})
