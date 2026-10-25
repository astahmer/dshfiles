import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPricingCatalog, PricingCatalogModel, type PricingCache } from './pricing-catalog.js'

const modelsDev = {
  openai: {
    id: 'openai',
    models: {
      'gpt-6-luna': {
        id: 'gpt-6-luna',
        cost: {
          input: 0.1,
          output: 0.5,
          cache_read: 0.01,
          cache_write: 0.125,
          tiers: [{ input: 0.2, output: 0.75, cache_read: 0.02, cache_write: 0.25, tier: { type: 'context', size: 272_000 } }],
        },
      },
      'text-embedding-3-small': { id: 'text-embedding-3-small' },
    },
  },
  anthropic: { models: { 'claude-opus-5-5': { cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } } } },
  deepseek: { models: { 'deepseek-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } } } },
  'opencode-go': {
    models: {
      'deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
      'space-bunny-free': { cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } },
      'gpt-6-luna': { cost: { input: 9, output: 9, tiers: [{ input: 1, output: 1, tier: { type: 'context', size: 200_001 } }] } },
    },
  },
  broken: { models: 'nope' },
}

const cache: PricingCache = PricingCatalogModel.trimModelsDev(modelsDev, 1_000)

describe('trimModelsDev', () => {
  it('keeps priced models, drops unpriced ones and malformed providers', () => {
    expect(Object.keys(cache.providers).sort()).toEqual(['anthropic', 'deepseek', 'openai', 'opencode-go'])
    expect(cache.providers['openai']?.['text-embedding-3-small']).toBeUndefined()
    expect(cache.providers['openai']?.['gpt-6-luna']).toEqual({
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      tiers: [{ above: 272_000, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 }],
    })
  })

  it('reads a `size + 1` tier as the same threshold', () => {
    expect(cache.providers['opencode-go']?.['gpt-6-luna']?.tiers?.[0]?.above).toBe(200_000)
  })
})

describe('resolveRouteQuote', () => {
  const quote = (provider: string, model: string, extra: { accountKind?: string; overrides?: Record<string, string> } = {}) => {
    const result = PricingCatalogModel.resolveRouteQuote({
      route: { provider, model },
      cache,
      overrides: extra.overrides ?? {},
      ...(extra.accountKind !== undefined && { accountKind: extra.accountKind }),
    })
    return { modelsDevId: result.modelsDevId, match: result.match, free: result.free }
  }

  it('maps an account route to its kind provider before any reseller', () => {
    expect(quote('codex-emialex', 'gpt-6-luna', { accountKind: 'codex' })).toEqual({ modelsDevId: 'openai/gpt-6-luna', match: 'exact', free: false })
    expect(quote('claude_work', 'claude-opus-5-5', { accountKind: 'claude' })).toEqual({
      modelsDevId: 'anthropic/claude-opus-5-5',
      match: 'exact',
      free: false,
    })
  })

  it('strips a route prefix from the model id', () => {
    expect(quote('opencode-go-alex', 'opencode-go/deepseek-v4.1-flash', { accountKind: 'opencode-go' }).modelsDevId).toBe('opencode-go/deepseek-v4.1-flash')
  })

  it('resolves native route aliases', () => {
    expect(quote('deepseek-official', 'deepseek-flash').modelsDevId).toBe('deepseek/deepseek-flash')
    expect(quote('openai-codex', 'gpt-6-luna').modelsDevId).toBe('openai/gpt-6-luna')
  })

  it('falls back to the vendor price for a reseller with no catalog of its own', () => {
    expect(quote('commandcode_work', 'gpt-6-luna', { accountKind: 'commandcode' })).toEqual({ modelsDevId: 'openai/gpt-6-luna', match: 'fuzzy', free: false })
  })

  it('matches across dot/dash and date-suffix spellings', () => {
    expect(quote('anthropic', 'claude-opus-5.5-20261001')).toEqual({ modelsDevId: 'anthropic/claude-opus-5-5', match: 'fuzzy', free: false })
  })

  it('reports free models and unknown ones', () => {
    expect(quote('opencode-go-alex', 'space-bunny-free', { accountKind: 'opencode-go' }).free).toBe(true)
    expect(quote('commandcode', 'stealth/space-bunny-alpha')).toEqual({ modelsDevId: null, match: 'none', free: false })
  })

  it('applies exact overrides before wildcard ones', () => {
    const overrides = { 'commandcode/*': 'free', 'commandcode/gpt-6-luna': 'anthropic/claude-opus-5-5' }
    expect(quote('commandcode', 'gpt-6-luna', { overrides })).toEqual({ modelsDevId: 'anthropic/claude-opus-5-5', match: 'override', free: false })
    expect(quote('commandcode', 'stealth/space-bunny-alpha', { overrides })).toEqual({ modelsDevId: null, match: 'override', free: true })
  })

  it('prices an explicit override even without a catalog', () => {
    const result = PricingCatalogModel.resolveRouteQuote({
      route: { provider: 'local', model: 'm' },
      cache: null,
      overrides: { 'local/m': 'input=1 output=2 cacheRead=0.1' },
    })
    expect(result.price).toEqual({ input: 1, output: 2, cacheRead: 0.1 })
  })
})

describe('parsePricingOverride', () => {
  it('rejects values it cannot read', () => {
    expect(PricingCatalogModel.parsePricingOverride('input=abc')).toBeUndefined()
    expect(PricingCatalogModel.parsePricingOverride('bogus=1 input=1 output=1')).toBeUndefined()
    expect(PricingCatalogModel.parsePricingOverride('no-slash')).toBeUndefined()
    expect(PricingCatalogModel.parsePricingOverride('input=1')).toBeUndefined()
  })
})

describe('createPricingCatalog', () => {
  let directory = ''
  afterEach(async () => {
    if (directory !== '') await rm(directory, { recursive: true, force: true })
  })

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('fetches, trims and caches the catalog, then serves the cache offline', async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-accounts-pricing-'))
    const path = join(directory, 'nested', 'pricing.json')
    let now = 10_000
    const online = createPricingCatalog({ path, now: () => now, fetch: async () => jsonResponse(modelsDev) })
    const status = await online.refresh()
    expect(status).toMatchObject({ fetchedAt: 10_000, modelCount: 6, refreshing: false, lastError: null })
    expect(JSON.parse(await readFile(path, 'utf8')).providers.openai['gpt-6-luna'].input).toBe(0.1)

    now = 20_000
    const offline = createPricingCatalog({
      path,
      now: () => now,
      fetch: async () => {
        throw new Error('offline')
      },
    })
    await offline.load()
    expect(offline.current()?.fetchedAt).toBe(10_000)
    const afterFailure = await offline.refresh()
    expect(afterFailure).toMatchObject({ fetchedAt: 10_000, lastError: 'offline' })
  })

  it('refreshes only once the cache is older than the period, and shares one request', async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-accounts-pricing-'))
    const path = join(directory, 'pricing.json')
    let now = 0
    let requests = 0
    const catalog = createPricingCatalog({
      path,
      now: () => now,
      fetch: async () => {
        requests += 1
        return jsonResponse(modelsDev)
      },
    })
    await Promise.all([catalog.ensureFresh(1_000), catalog.ensureFresh(1_000)])
    expect(requests).toBe(1)
    now = 500
    await catalog.ensureFresh(1_000)
    expect(requests).toBe(1)
    now = 1_500
    await catalog.ensureFresh(1_000)
    expect(requests).toBe(2)
  })

  it('keeps the last catalog when models.dev answers an error or nothing priced', async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-accounts-pricing-'))
    const path = join(directory, 'pricing.json')
    await writeFile(path, JSON.stringify(cache), 'utf8')
    const responses = [jsonResponse({}, 503), jsonResponse({ empty: { models: {} } })]
    const catalog = createPricingCatalog({ path, fetch: async () => responses.shift() ?? jsonResponse({}) })
    await catalog.load()
    expect((await catalog.refresh()).lastError).toBe('models.dev answered 503')
    expect((await catalog.refresh()).lastError).toBe('models.dev returned no priced models')
    expect(catalog.current()?.fetchedAt).toBe(1_000)
  })
})
