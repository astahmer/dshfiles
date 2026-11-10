import { describe, expect, it } from 'vitest'
import type { RouteQuote } from './cost-estimate.js'
import { IdleCacheModel } from './idle-cache-model.js'

const MINUTE = 60_000
const claude: RouteQuote = {
  provider: 'claude-main',
  model: 'claude-sonnet-4-5',
  modelsDevId: 'anthropic/claude-sonnet-4-5',
  match: 'exact',
  free: false,
  price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
}
const codex: RouteQuote = {
  provider: 'codex-main',
  model: 'gpt-5.1-codex',
  modelsDevId: 'openai/gpt-5.1-codex',
  match: 'exact',
  free: false,
  price: { input: 1.25, output: 10, cacheRead: 0.125 },
}

const base = {
  now: 100 * MINUTE,
  lastUsedAt: 90 * MINUTE,
  running: false,
  promptTokens: 120_000,
  minTokens: 50_000,
  route: { provider: claude.provider, model: claude.model },
  quote: claude,
  overrides: {},
}

describe('IdleCacheModel.lifetime', () => {
  it('uses the published default per vendor, from models.dev or the model name', () => {
    expect(IdleCacheModel.lifetime({ provider: 'x', model: 'm', modelsDevId: 'anthropic/m', overrides: {} })).toEqual({ minutes: 5, source: 'known' })
    expect(IdleCacheModel.lifetime({ provider: 'x', model: 'claude-opus-4', modelsDevId: null, overrides: {} })).toEqual({ minutes: 5, source: 'known' })
    expect(IdleCacheModel.lifetime({ provider: 'codex-main', model: 'gpt-5.1', modelsDevId: null, overrides: {} })).toEqual({ minutes: 10, source: 'known' })
    expect(IdleCacheModel.lifetime({ provider: 'deepseek', model: 'deepseek-chat', modelsDevId: 'deepseek/deepseek-chat', overrides: {} })).toBeNull()
  })

  it('prefers a route override, then a provider-wide one', () => {
    const overrides = { 'claude-main/claude-opus-4': 60, 'claude-main/*': 30 }
    expect(IdleCacheModel.lifetime({ provider: 'claude-main', model: 'claude-opus-4', modelsDevId: null, overrides })).toEqual({
      minutes: 60,
      source: 'override',
    })
    expect(IdleCacheModel.lifetime({ provider: 'claude-main', model: 'claude-haiku', modelsDevId: null, overrides })).toEqual({
      minutes: 30,
      source: 'override',
    })
    expect(IdleCacheModel.lifetime({ provider: 'deepseek', model: 'deepseek-chat', modelsDevId: null, overrides: { 'deepseek/*': 120 } })).toEqual({
      minutes: 120,
      source: 'override',
    })
  })
})

describe('IdleCacheModel.of', () => {
  it('warns once a long thread sat idle past its cache lifetime, pricing the uncached prompt as a cache write', () => {
    const facts = IdleCacheModel.of(base)
    expect(facts).toEqual({
      promptTokens: 120_000,
      idleMinutes: 10,
      lifetime: { minutes: 5, source: 'known' },
      uncachedUsd: (120_000 * 3.75) / 1_000_000,
      cachedUsd: (120_000 * 0.3) / 1_000_000,
    })
    expect(IdleCacheModel.label(facts!)).toBe('cache expired · next send ≈$0.45')
    expect(IdleCacheModel.detail(facts!)).toBe(
      "Idle 10 min, past the prompt cache's 5 min. The next message re-sends ~120K prompt tokens uncached: ≈$0.45 instead of ≈$0.04 cached.",
    )
  })

  it('bills the plain input rate where the price has no cache-write surcharge', () => {
    const facts = IdleCacheModel.of({ ...base, route: { provider: codex.provider, model: codex.model }, quote: codex, lastUsedAt: 80 * MINUTE })
    expect(facts?.uncachedUsd).toBeCloseTo((120_000 * 1.25) / 1_000_000)
    expect(facts?.lifetime).toEqual({ minutes: 10, source: 'known' })
  })

  it('stays quiet while the cache is warm, a turn runs, the thread is short or the lifetime is unknown', () => {
    expect(IdleCacheModel.of({ ...base, lastUsedAt: 96 * MINUTE })).toBeNull()
    expect(IdleCacheModel.of({ ...base, running: true })).toBeNull()
    expect(IdleCacheModel.of({ ...base, promptTokens: 20_000 })).toBeNull()
    expect(IdleCacheModel.of({ ...base, promptTokens: undefined })).toBeNull()
    expect(IdleCacheModel.of({ ...base, lastUsedAt: null })).toBeNull()
    expect(IdleCacheModel.of({ ...base, route: { provider: 'deepseek', model: 'deepseek-chat' }, quote: undefined })).toBeNull()
  })

  it('keeps a below-display amount as a bound instead of an approximation', () => {
    const facts = IdleCacheModel.of({ ...base, promptTokens: 13, minTokens: 0 })
    expect(IdleCacheModel.label(facts!)).toBe('cache expired · next send <$0.0001')
  })

  it('still names the uncached tokens when the route has no price', () => {
    const facts = IdleCacheModel.of({ ...base, quote: { ...claude, price: null, match: 'none' } })
    expect(facts?.uncachedUsd).toBeNull()
    expect(IdleCacheModel.label(facts!)).toBe('cache expired · 120K uncached')
  })
})

describe('IdleCacheModel.referencePrompt', () => {
  it('names the earlier thread and carries the draft', () => {
    expect(IdleCacheModel.referencePrompt({ sessionId: 'session-1', title: 'Fix rounding', draft: '  next: add tests ' })).toBe(
      'Continue from the earlier thread “Fix rounding” (session-1). Look up only what you need from it with find_threads or memory_read instead of replaying it.\n\nnext: add tests',
    )
    expect(IdleCacheModel.referencePrompt({ sessionId: 'session-1', title: undefined, draft: '' })).toContain('earlier thread session-1.')
  })
})
