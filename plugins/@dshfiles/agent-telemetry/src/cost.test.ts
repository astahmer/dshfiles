import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { PricingCache } from '@dshfiles/ai-accounts/pricing-catalog'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { createCoordinator, type ObservedSession } from './coordinator.js'
import { CostAttributes, createCallPricer } from './cost.js'

const catalog: PricingCache = {
  version: 1,
  fetchedAt: 1,
  source: 'test',
  providers: {
    openai: { 'gpt-test': { input: 2, output: 8, cacheRead: 0.5, tiers: [{ above: 200_000, input: 4, output: 16, cacheRead: 1 }] } },
    kilo: { free: { input: 0, output: 0 } },
  },
}

const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0 }

describe('createCallPricer', () => {
  it('prices uncached input, output and cache reads at the band the prompt reaches', () => {
    const price = createCallPricer({ catalog: () => catalog, accountKind: () => undefined })
    // 3M prompt tokens exceed the 200k tier: 1M × 4 + 0.5M × 16 + 2M × 1 = 14 USD.
    expect(price({ provider: 'openai', model: 'gpt-test', usage })).toEqual({ usd: 14, priceId: 'openai/gpt-test' })
    expect(price({ provider: 'openai', model: 'gpt-test', usage: { inputTokens: 1_000, outputTokens: 1_000 } })?.usd).toBeCloseTo(0.01)
  })

  it('resolves a subscription route through its account kind and leaves an unpriced route undefined', () => {
    const price = createCallPricer({ catalog: () => catalog, accountKind: provider => (provider === 'codex-2' ? 'codex' : undefined) })
    expect(price({ provider: 'codex-2', model: 'gpt-test', usage })?.priceId).toBe('openai/gpt-test')
    expect(price({ provider: 'nowhere', model: 'unknown-model', usage })).toBeUndefined()
    expect(createCallPricer({ catalog: () => null, accountKind: () => undefined })({ provider: 'openai', model: 'gpt-test', usage })).toBeUndefined()
  })

  it('reprices once the catalog reloads', () => {
    let current = catalog
    const price = createCallPricer({ catalog: () => current, accountKind: () => undefined })
    const call = { provider: 'openai', model: 'gpt-test', usage: { inputTokens: 100_000, outputTokens: 0 } }
    expect(price(call)?.usd).toBeCloseTo(0.2)
    current = { ...catalog, fetchedAt: 2, providers: { openai: { 'gpt-test': { input: 3, output: 8 } } } }
    expect(price(call)?.usd).toBeCloseTo(0.3)
  })
})

const chunks = (inputTokens: number): StreamChunk[] => [
  { type: 'usage', usage: { inputTokens, outputTokens: 0 } },
  { type: 'finish', reason: { kind: 'stop' } },
]

const stream = async function* (items: readonly StreamChunk[]): AsyncGenerator<StreamChunk> {
  yield* items
}

const drain = async (iterable: AsyncIterable<StreamChunk>): Promise<void> => {
  for await (const _chunk of iterable);
}

describe('cost on spans', () => {
  it('puts dshx.cost.usd on every priced chat span and their sum on the turn span', async () => {
    using recorder = recordSpans()
    const observer = createCoordinator({
      captureContent: () => false,
      warn: () => undefined,
      priceCall: createCallPricer({ catalog: () => catalog, accountKind: () => undefined }),
    })
    const observed: ObservedSession = { id: 's-cost', header: {} }
    observer.onEvent(observed, { type: 'turn/start', data: { turn: 1 } })
    observer.onEvent(observed, { type: 'step/start', data: { turn: 1, step: 1 } })
    await drain(observer.interceptLlm({ provider: 'openai', model: 'gpt-test', sessionId: observed.id }, () => stream(chunks(1_000_000))))
    observer.onEvent(observed, { type: 'step/end', data: { turn: 1, step: 1 } })
    observer.onEvent(observed, { type: 'step/start', data: { turn: 1, step: 2 } })
    await drain(observer.interceptLlm({ provider: 'openai', model: 'gpt-test', sessionId: observed.id }, () => stream(chunks(500_000))))
    await drain(observer.interceptLlm({ provider: 'kilo', model: 'unpriced-model', sessionId: observed.id }, () => stream(chunks(10))))
    observer.onEvent(observed, { type: 'step/end', data: { turn: 1, step: 2 } })
    observer.onEvent(observed, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

    const chats = recorder.spans.filter(span => span.name === 'chat gpt-test')
    expect(chats.map(span => span.attributes[CostAttributes.usd])).toEqual([4, 2])
    expect(chats[0]?.attributes[CostAttributes.priceId]).toBe('openai/gpt-test')
    expect(recorder.span('chat unpriced-model').attributes[CostAttributes.usd]).toBeUndefined()
    expect(recorder.span('invoke_agent deepseek-harness').attributes[CostAttributes.usd]).toBe(6)
  })

  it('leaves spans unpriced, and the model path intact, when pricing throws', async () => {
    using recorder = recordSpans()
    const warnings: string[] = []
    const observer = createCoordinator({
      captureContent: () => false,
      warn: message => warnings.push(message),
      priceCall: () => {
        throw new TypeError('broken catalog')
      },
    })
    await drain(observer.interceptLlm({ provider: 'openai', model: 'gpt-test', sessionId: undefined }, () => stream(chunks(10))))
    expect(recorder.span('chat gpt-test')).toMatchObject({ status: { code: 'ok' } })
    expect(recorder.span('chat gpt-test').attributes[CostAttributes.usd]).toBeUndefined()
    expect(warnings).toEqual(['agent-telemetry: pricing a model call failed: TypeError'])
  })
})
