import { describe, expect, it } from 'vitest'
import { CostEstimateModel, type CostGroup, type ModelPrice, type RouteQuote } from './cost-estimate.js'

const tokens = (input: Partial<CostGroup['tokens']>): CostGroup['tokens'] => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...input,
})

const quote = (provider: string, model: string, price: ModelPrice | null, free = false): RouteQuote => ({
  provider,
  model,
  modelsDevId: price === null ? null : `openai/${model}`,
  match: price === null ? 'none' : 'exact',
  free,
  price,
})

const luna: ModelPrice = {
  input: 0.1,
  output: 0.5,
  cacheRead: 0.01,
  cacheWrite: 0.125,
  tiers: [{ above: 272_000, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 }],
}

describe('contextBand', () => {
  it('records the widest published tier size the prompt exceeds', () => {
    expect(CostEstimateModel.contextBand(10_000)).toBe(0)
    expect(CostEstimateModel.contextBand(200_000)).toBe(128_000)
    expect(CostEstimateModel.contextBand(200_001)).toBe(200_000)
    expect(CostEstimateModel.contextBand(300_000)).toBe(272_000)
  })
})

describe('costOfTokens', () => {
  it('bills each bucket at its own rate per million tokens', () => {
    const cost = CostEstimateModel.costOfTokens({
      tokens: tokens({ uncachedInputTokens: 1_000_000, outputTokens: 2_000_000, cacheReadTokens: 10_000_000, cacheWriteTokens: 1_000_000 }),
      price: luna,
      band: 0,
    })
    expect(cost.input).toBeCloseTo(0.1)
    expect(cost.output).toBeCloseTo(1)
    expect(cost.cacheRead).toBeCloseTo(0.1)
    expect(cost.cacheWrite).toBeCloseTo(0.125)
    expect(cost.total).toBeCloseTo(1.325)
  })

  it('switches to the tier rates once the prompt exceeds the tier size', () => {
    expect(CostEstimateModel.costOfTokens({ tokens: tokens({ outputTokens: 1_000_000 }), price: luna, band: 272_000 }).total).toBe(0.75)
    expect(CostEstimateModel.costOfTokens({ tokens: tokens({ outputTokens: 1_000_000 }), price: luna, band: 256_000 }).total).toBe(0.5)
  })

  it('bills cache traffic as input when the model publishes no cache rate', () => {
    const cost = CostEstimateModel.costOfTokens({
      tokens: tokens({ cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }),
      price: { input: 2, output: 8 },
      band: 0,
    })
    expect(cost.cacheRead).toBe(2)
    expect(cost.cacheWrite).toBe(2)
  })
})

describe('estimateCost', () => {
  const groups: CostGroup[] = [
    { provider: 'codex-emialex', model: 'gpt-6-luna', band: 0, requests: 2, tokens: tokens({ uncachedInputTokens: 1_000_000 }) },
    { provider: 'codex-emialex', model: 'gpt-6-luna', band: 272_000, requests: 1, tokens: tokens({ uncachedInputTokens: 1_000_000 }) },
    { provider: 'commandcode', model: 'stealth/space-bunny-alpha', band: 0, requests: 1, tokens: tokens({ outputTokens: 500 }) },
  ]

  it('sums priced routes and flags unpriced usage as a lower bound', () => {
    const estimate = CostEstimateModel.estimateCost({
      groups,
      quotes: new Map([['codex-emialex/gpt-6-luna', quote('codex-emialex', 'gpt-6-luna', luna)]]),
    })
    expect(estimate.cost.total).toBeCloseTo(0.3)
    expect(estimate.partial).toBe(true)
    expect(estimate.priced).toBe(true)
    expect(estimate.routes.map(route => [route.model, route.requests])).toEqual([
      ['gpt-6-luna', 3],
      ['stealth/space-bunny-alpha', 1],
    ])
    expect(estimate.routes[0]?.cost?.total).toBeCloseTo(0.3)
    expect(estimate.routes[1]?.cost).toBeNull()
  })

  it('is not priced when every known route is free', () => {
    const estimate = CostEstimateModel.estimateCost({
      groups: [groups[2]!],
      quotes: new Map([['commandcode/stealth/space-bunny-alpha', quote('commandcode', 'stealth/space-bunny-alpha', { input: 0, output: 0 }, true)]]),
    })
    expect(estimate.priced).toBe(false)
    expect(estimate.cost.total).toBe(0)
  })
})

describe('formatUsd', () => {
  it('keeps small session totals readable', () => {
    expect(CostEstimateModel.formatUsd(0)).toBe('$0.00')
    expect(CostEstimateModel.formatUsd(0.00004)).toBe('<$0.0001')
    expect(CostEstimateModel.formatUsd(0.0031)).toBe('$0.0031')
    expect(CostEstimateModel.formatUsd(0.4234)).toBe('$0.42')
    expect(CostEstimateModel.formatUsd(1234.5)).toBe('$1,235')
  })
})
