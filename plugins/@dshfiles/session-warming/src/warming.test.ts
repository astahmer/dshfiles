import { Context as CordisContext } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { sessionWarmingSettings } from './settings.js'
import { SessionWarming, type WarmingSettingsValue } from './warming.js'

const settings = (overrides: Partial<WarmingSettingsValue> = {}): WarmingSettingsValue => ({
  enabled: true,
  intervalMinutes: 4,
  maxWarmupsPerIdle: 3,
  maxWarmupsPerHour: 30,
  providers: [],
  ...overrides,
})

const usage = { inputTokens: 12, cacheReadTokens: 5_000, cacheWriteTokens: 0, outputTokens: 1 }
const request: GenerateOptions = { provider: 'anthropic', model: 'claude', messages: [], maxTokens: 8_000 }

/** A provider adapter that records what DSH sent it and answers from `reply`. */
class RecordingAdapter extends LlmAdapter {
  readonly sent: GenerateOptions[] = []
  constructor(private readonly reply: (options: GenerateOptions) => AsyncIterable<StreamChunk>) {
    super()
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.sent.push(options)
    return this.reply(options)
  }
}

const usageReply = async function* (): AsyncIterable<StreamChunk> {
  yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

const llmHost = (adapter: RecordingAdapter) =>
  Layer.effect(
    HostContext,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const ctx = new CordisContext()
        await ctx.plugin(LlmRuntime)
        ctx.llm.registerAdapter(['anthropic'], adapter)
        return ctx
      }),
      ctx => Effect.promise(() => ctx.fiber.dispose()),
    ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId: '@dshfiles/session-warming' }))),
  )

const warmingWith = (input: { readonly adapter: RecordingAdapter; readonly settings?: WarmingSettingsValue }) =>
  SessionWarming.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Llm.layer.pipe(Layer.provide(llmHost(input.adapter))),
        Settings.layerTest<WarmingSettingsValue>(sessionWarmingSettings.namespace, input.settings ?? settings()),
      ),
    ),
  )

const idleMinutes = (minutes: number) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(Duration.minutes(minutes))
    for (let tick = 0; tick < 20; tick += 1) yield* Effect.yieldNow
  })

describe('SessionWarming scheduler', () => {
  it.effect('re-sends the last request each interval after a turn, up to the per-idle limit, then waits for the next turn', () => {
    const adapter = new RecordingAdapter(usageReply)
    return Effect.gen(function* () {
      const warming = yield* SessionWarming
      yield* warming.handle({ kind: 'request', sessionId: 's1', request })
      yield* warming.handle({ kind: 'turn-end', sessionId: 's1' })
      for (let index = 0; index < 3; index += 1) yield* idleMinutes(4)
      expect(adapter.sent).toHaveLength(3)
      expect(adapter.sent[0]).toMatchObject({ provider: 'anthropic', model: 'claude', maxTokens: 1 })
      expect((yield* warming.status).sessions[0]).toMatchObject({ warmups: 3, stopped: 'idle-limit', last: usage, nextAt: null })
    }).pipe(Effect.provide(warmingWith({ adapter })))
  })

  it.effect('never warms while disabled or for a provider outside the list', () =>
    Effect.gen(function* () {
      for (const current of [settings({ enabled: false }), settings({ providers: ['openai'] })]) {
        const adapter = new RecordingAdapter(usageReply)
        yield* Effect.gen(function* () {
          const warming = yield* SessionWarming
          yield* warming.handle({ kind: 'request', sessionId: 's1', request })
          yield* warming.handle({ kind: 'turn-end', sessionId: 's1' })
          yield* idleMinutes(30)
          expect(adapter.sent).toEqual([])
          expect((yield* warming.status).sessions[0]?.stopped).toBe('disabled')
        }).pipe(Effect.provide(warmingWith({ adapter, settings: current })))
      }
    }),
  )

  it.effect('stops a thread whose warm-up failed until its next turn', () => {
    const adapter = new RecordingAdapter(async function* () {
      yield { type: 'usage', usage }
      throw new Error('max_tokens must exceed the thinking budget')
    })
    return Effect.gen(function* () {
      const warming = yield* SessionWarming
      yield* warming.handle({ kind: 'request', sessionId: 's1', request })
      yield* warming.handle({ kind: 'turn-end', sessionId: 's1' })
      yield* idleMinutes(4)
      expect((yield* warming.status).sessions[0]).toMatchObject({ warmups: 1, stopped: 'failed', error: 'max_tokens must exceed the thinking budget' })
      yield* idleMinutes(30)
      expect(adapter.sent).toHaveLength(1)
    }).pipe(Effect.provide(warmingWith({ adapter })))
  })

  it.effect('shares one rolling hourly budget across threads', () => {
    const adapter = new RecordingAdapter(usageReply)
    return Effect.gen(function* () {
      const warming = yield* SessionWarming
      for (const sessionId of ['s1', 's2']) {
        yield* warming.handle({ kind: 'request', sessionId, request })
        yield* warming.handle({ kind: 'turn-end', sessionId })
      }
      yield* idleMinutes(4)
      yield* idleMinutes(4)
      expect(adapter.sent).toHaveLength(2)
      expect((yield* warming.status).sessions.map(session => session.stopped)).toEqual(['hourly-limit', 'hourly-limit'])
      expect((yield* warming.status).warmupsLastHour).toBe(2)
    }).pipe(Effect.provide(warmingWith({ adapter, settings: settings({ maxWarmupsPerHour: 2, maxWarmupsPerIdle: 5 }) })))
  })

  it.effect('drops a thread’s timer when its model changes, its next turn starts or it is forgotten', () => {
    const adapter = new RecordingAdapter(usageReply)
    return Effect.gen(function* () {
      const warming = yield* SessionWarming
      yield* warming.handle({ kind: 'request', sessionId: 's1', request })
      yield* warming.handle({ kind: 'turn-end', sessionId: 's1' })
      yield* warming.handle({ kind: 'request', sessionId: 's1', request: { ...request, model: 'other' } })
      yield* warming.handle({ kind: 'request', sessionId: 's2', request })
      yield* warming.handle({ kind: 'turn-end', sessionId: 's2' })
      yield* warming.handle({ kind: 'forget', sessionId: 's2' })
      yield* warming.handle({ kind: 'request', sessionId: 's3', request })
      yield* warming.handle({ kind: 'turn-end', sessionId: 's3' })
      yield* warming.handle({ kind: 'turn-start', sessionId: 's3' })
      yield* idleMinutes(10)
      expect(adapter.sent).toEqual([])
      expect((yield* warming.status).sessions.map(session => [session.sessionId, session.nextAt])).toEqual([
        ['s1', null],
        ['s3', null],
      ])
    }).pipe(Effect.provide(warmingWith({ adapter })))
  })
})

describe('SessionWarming warm-up span', () => {
  it.effect('reports the cache reads of a warm-up in its span', () => {
    const adapter = new RecordingAdapter(async function* () {
      yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 1, cacheReadTokens: 9_000 } }
      yield { type: 'finish', reason: { kind: 'length' } }
    })
    return Effect.gen(function* () {
      using recorder = recordSpans()
      const warming = yield* SessionWarming
      yield* warming.handle({ kind: 'request', sessionId: 's1', request })
      yield* warming.handle({ kind: 'turn-end', sessionId: 's1' })
      yield* idleMinutes(4)
      expect((yield* warming.status).sessions[0]?.last).toEqual({ inputTokens: 20, outputTokens: 1, cacheReadTokens: 9_000, cacheWriteTokens: 0 })
      expect(recorder.span('session-warming warm').attributes['session_warming.cache_read_tokens']).toBe(9_000)
    }).pipe(Effect.provide(Layer.merge(warmingWith({ adapter }), DshxEffect.tracerLayer)))
  })
})
