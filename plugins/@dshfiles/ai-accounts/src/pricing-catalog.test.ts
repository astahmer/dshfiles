import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Schema } from 'effect'
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http'
import { PricingCatalog } from './pricing-catalog-service.js'
import { PricingCatalogModel, type PricingCache } from './pricing-catalog.js'

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

/** models.dev is external: the test client answers each request from a script and counts the requests it saw. */
type Reply = { readonly body: unknown } | { readonly status: number } | { readonly failure: string }

const modelsDevTest = (replies: ReadonlyArray<Reply>) => {
  const seen = { count: 0 }
  const client = HttpClient.make(request =>
    Effect.suspend(() => {
      const reply = replies[seen.count] ?? { status: 503 }
      seen.count += 1
      if ('failure' in reply)
        return Effect.fail(new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, description: reply.failure }) }))
      if ('status' in reply) return Effect.succeed(HttpClientResponse.fromWeb(request, new Response('{}', { status: reply.status })))
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(reply.body)))
    }),
  )
  return { client, requests: () => seen.count }
}

const statePath = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'ai-accounts-pricing-' })
  return { fs, path, directory }
})

const openCatalog = (client: HttpClient.HttpClient, file: string) =>
  Effect.provide(PricingCatalog.make({ path: file, retry: false }), Layer.merge(Layer.succeed(HttpClient.HttpClient, client), NodeServices.layer))

describe('PricingCatalog', () => {
  it.layer(NodeServices.layer)(it => {
    it.effect('fetches, trims and caches the catalog, then serves the cache offline', () =>
      Effect.gen(function* () {
        const { fs, path, directory } = yield* statePath
        const file = path.join(directory, 'nested', 'pricing.json')
        const onlineClient = modelsDevTest([{ body: modelsDev }])
        const online = yield* openCatalog(onlineClient.client, file)
        const status = yield* online.refresh
        expect(status).toMatchObject({ modelCount: 6, refreshing: false, lastError: null })
        const written = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PricingCatalogModel.cacheSchema))(yield* fs.readFileString(file))
        expect(written.providers['openai']?.['gpt-6-luna']?.input).toBe(0.1)

        const offlineClient = modelsDevTest([{ failure: 'offline' }])
        const offline = yield* openCatalog(offlineClient.client, file)
        yield* offline.load
        expect(offline.snapshot()?.fetchedAt).toBe(written.fetchedAt)
        const afterFailure = yield* offline.refresh
        expect(afterFailure.fetchedAt).toBe(written.fetchedAt)
        expect(afterFailure.lastError).toBe('models.dev could not be read')
      }),
    )

    it.effect('refreshes only once the cache is older than the period', () =>
      Effect.gen(function* () {
        const { path, directory } = yield* statePath
        const client = modelsDevTest([{ body: modelsDev }])
        const catalog = yield* openCatalog(client.client, path.join(directory, 'pricing.json'))
        yield* catalog.ensureFresh(1_000)
        expect(client.requests()).toBe(1)
        yield* catalog.ensureFresh(1_000)
        expect(client.requests()).toBe(1)
      }),
    )

    it.effect('keeps the last catalog when models.dev answers an error or nothing priced', () =>
      Effect.gen(function* () {
        const { fs, path, directory } = yield* statePath
        const file = path.join(directory, 'pricing.json')
        yield* fs.writeFileString(file, JSON.stringify(cache))
        const client = modelsDevTest([{ status: 503 }, { body: { empty: { models: {} } } }])
        const catalog = yield* openCatalog(client.client, file)
        yield* catalog.load
        expect((yield* catalog.refresh).lastError).toBe('models.dev answered 503')
        expect((yield* catalog.refresh).lastError).toBe('models.dev returned no priced models')
        expect(catalog.snapshot()?.fetchedAt).toBe(1_000)
      }),
    )

    it.effect('records a transport failure as a readable message', () =>
      Effect.gen(function* () {
        const { path, directory } = yield* statePath
        const client = modelsDevTest([{ failure: 'connect ECONNREFUSED' }])
        const catalog = yield* openCatalog(client.client, path.join(directory, 'pricing.json'))
        const status = yield* catalog.refresh
        expect(status.lastError).toBe('models.dev could not be read')
        expect(status.refreshing).toBe(false)
      }),
    )
  })
})
