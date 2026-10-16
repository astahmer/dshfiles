import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { CostEstimateModel, modelPriceSchema, type ModelPrice, type RouteQuote } from './cost-estimate.js'

/**
 * Model prices from models.dev, cached on disk so a cold or offline Host still
 * prices with the last catalog it saw. Only the price fields are kept: the full
 * api.json is several megabytes of capabilities this plugin never reads.
 */

export const MODELS_DEV_URL = 'https://models.dev/api.json'

export const DEFAULT_PRICING_PATH = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'ai-accounts', 'pricing.json')

const FETCH_TIMEOUT_MS = 30_000

const pricingCacheSchema = z.object({
  version: z.literal(1),
  fetchedAt: z.number(),
  source: z.string(),
  providers: z.record(z.string(), z.record(z.string(), modelPriceSchema)),
})

export type PricingCache = z.infer<typeof pricingCacheSchema>

const rawRateShape = {
  input: z.number().min(0),
  output: z.number().min(0),
  cache_read: z.number().min(0).optional(),
  cache_write: z.number().min(0).optional(),
}

const rawCostSchema = z.object({
  ...rawRateShape,
  tiers: z.array(z.object({ ...rawRateShape, tier: z.object({ type: z.string(), size: z.number().int().min(0) }) })).optional(),
})

const rawProviderSchema = z.object({ models: z.record(z.string(), z.object({ cost: z.unknown().optional() })) })

/**
 * models.dev publishes tier sizes both as `200000` and `200001`; either means
 * "the prompt exceeds 200k", which is the band the fold records.
 */
const tierThreshold = (size: number): number => (size % 1_000 === 1 ? size - 1 : size)

const toModelPrice = (raw: unknown): ModelPrice | undefined => {
  const parsed = rawCostSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const cost = parsed.data
  const tiers = (cost.tiers ?? [])
    .filter(tier => tier.tier.type === 'context')
    .map(tier => ({
      above: tierThreshold(tier.tier.size),
      input: tier.input,
      output: tier.output,
      ...(tier.cache_read === undefined ? {} : { cacheRead: tier.cache_read }),
      ...(tier.cache_write === undefined ? {} : { cacheWrite: tier.cache_write }),
    }))
    .slice(0, 8)
  return {
    input: cost.input,
    output: cost.output,
    ...(cost.cache_read === undefined ? {} : { cacheRead: cost.cache_read }),
    ...(cost.cache_write === undefined ? {} : { cacheWrite: cost.cache_write }),
    ...(tiers.length === 0 ? {} : { tiers }),
  }
}

/** Keep every model that publishes a usable price; skip the rest without failing the catalog. */
const trimModelsDev = (raw: unknown, fetchedAt: number): PricingCache => {
  const providers: Record<string, Record<string, ModelPrice>> = {}
  if (typeof raw === 'object' && raw !== null) {
    for (const [providerId, provider] of Object.entries(raw)) {
      const parsed = rawProviderSchema.safeParse(provider)
      if (!parsed.success) continue
      const models: Record<string, ModelPrice> = {}
      for (const [modelId, model] of Object.entries(parsed.data.models)) {
        const price = toModelPrice(model.cost)
        if (price !== undefined) models[modelId] = price
      }
      if (Object.keys(models).length > 0) providers[providerId] = models
    }
  }
  return { version: 1, fetchedAt, source: MODELS_DEV_URL, providers }
}

/** Account kinds served by one models.dev provider; Command Code and Cursor resell many. */
const KIND_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  codex: ['openai'],
  claude: ['anthropic'],
  'opencode-go': ['opencode-go'],
}

/** DSH route ids whose models.dev provider has another name. */
const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  codex: 'openai',
  'openai-codex': 'openai',
  claude: 'anthropic',
  'deepseek-official': 'deepseek',
  gemini: 'google',
  'google-gemini-cli': 'google',
}

/** Vendors first, so a fuzzy match prefers the lab's own price over a reseller's. */
const PROVIDER_PREFERENCE = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'mistral',
  'moonshotai',
  'zai',
  'alibaba',
  'minimax',
  'opencode-go',
  'opencode',
  'openrouter',
]

const normalizeModelId = (id: string): string =>
  id
    .toLowerCase()
    .replace(/:free$/, '')
    .replace(/-(latest|\d{8})$/, '')
    .replaceAll('.', '-')

const modelCandidates = (model: string): string[] => {
  const tail = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model
  return [...new Set([model, tail])].filter(candidate => candidate.length > 0)
}

export type PricingOverride =
  | { readonly kind: 'models-dev'; readonly provider: string; readonly model: string }
  | { readonly kind: 'price'; readonly price: ModelPrice }

const OVERRIDE_PRICE_KEYS: Readonly<Record<string, keyof Omit<ModelPrice, 'tiers'>>> = {
  input: 'input',
  in: 'input',
  output: 'output',
  out: 'output',
  cacheread: 'cacheRead',
  cache_read: 'cacheRead',
  cachewrite: 'cacheWrite',
  cache_write: 'cacheWrite',
}

/**
 * One override value: `free`, a models.dev id (`openai/gpt-6-luna`), or USD per
 * million tokens (`input=3 output=15 cacheRead=0.3`). Anything else is ignored.
 */
const parsePricingOverride = (value: string): PricingOverride | undefined => {
  const trimmed = value.trim()
  if (trimmed.toLowerCase() === 'free') return { kind: 'price', price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  if (trimmed.includes('=')) {
    const rates: Partial<Record<keyof Omit<ModelPrice, 'tiers'>, number>> = {}
    for (const pair of trimmed.split(/[\s,;]+/).filter(Boolean)) {
      const [rawKey = '', rawValue = ''] = pair.split('=')
      const key = OVERRIDE_PRICE_KEYS[rawKey.trim().toLowerCase()]
      const amount = Number(rawValue)
      if (key === undefined || !Number.isFinite(amount) || amount < 0) return undefined
      rates[key] = amount
    }
    const parsed = modelPriceSchema.safeParse(rates)
    return parsed.success ? { kind: 'price', price: parsed.data } : undefined
  }
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) return undefined
  return { kind: 'models-dev', provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) }
}

interface CatalogIndex {
  readonly cache: PricingCache
  /** Normalized model id → first provider in preference order that prices it. */
  readonly byNormalizedId: ReadonlyMap<string, { readonly provider: string; readonly model: string }>
}

const indexes = new WeakMap<PricingCache, CatalogIndex>()

const indexCatalog = (cache: PricingCache): CatalogIndex => {
  const existing = indexes.get(cache)
  if (existing !== undefined) return existing
  const ordered = [
    ...PROVIDER_PREFERENCE.filter(provider => provider in cache.providers),
    ...Object.keys(cache.providers)
      .filter(provider => !PROVIDER_PREFERENCE.includes(provider))
      .sort(),
  ]
  const byNormalizedId = new Map<string, { readonly provider: string; readonly model: string }>()
  for (const provider of ordered) {
    for (const model of Object.keys(cache.providers[provider] ?? {})) {
      for (const candidate of modelCandidates(model)) {
        const key = normalizeModelId(candidate)
        if (!byNormalizedId.has(key)) byNormalizedId.set(key, { provider, model })
      }
    }
  }
  const index = { cache, byNormalizedId }
  indexes.set(cache, index)
  return index
}

const quoteFrom = (input: {
  readonly route: { readonly provider: string; readonly model: string }
  readonly match: RouteQuote['match']
  readonly modelsDevId: string | null
  readonly price: ModelPrice | null
}): RouteQuote => ({
  provider: input.route.provider,
  model: input.route.model,
  modelsDevId: input.modelsDevId,
  match: input.match,
  free: input.price !== null && CostEstimateModel.isFreePrice(input.price),
  price: input.price,
})

const findInProvider = (cache: PricingCache, provider: string, model: string): { readonly model: string; readonly exact: boolean } | undefined => {
  const models = cache.providers[provider]
  if (models === undefined) return undefined
  for (const candidate of modelCandidates(model)) if (candidate in models) return { model: candidate, exact: true }
  const wanted = new Set(modelCandidates(model).map(normalizeModelId))
  for (const id of Object.keys(models)) if (wanted.has(normalizeModelId(id))) return { model: id, exact: false }
  return undefined
}

/**
 * Price one DSH route. Order: a user override for the exact route, then for
 * `provider/*`; the route's own models.dev provider (by account kind, alias or
 * id); then any provider pricing the same normalized model id, vendors first.
 */
const resolveRouteQuote = (input: {
  readonly route: { readonly provider: string; readonly model: string }
  readonly cache: PricingCache | null
  readonly accountKind?: string | undefined
  readonly overrides: Readonly<Record<string, string>>
}): RouteQuote => {
  const { route, cache } = input
  const none = quoteFrom({ route, match: 'none', modelsDevId: null, price: null })
  const overrideValue = input.overrides[CostEstimateModel.routeKey(route)] ?? input.overrides[`${route.provider}/*`]
  const override = overrideValue === undefined ? undefined : parsePricingOverride(overrideValue)
  if (override?.kind === 'price') return quoteFrom({ route, match: 'override', modelsDevId: null, price: override.price })
  if (cache === null) return none
  if (override?.kind === 'models-dev') {
    const price = cache.providers[override.provider]?.[override.model]
    return price === undefined ? none : quoteFrom({ route, match: 'override', modelsDevId: `${override.provider}/${override.model}`, price })
  }
  const alias = PROVIDER_ALIASES[route.provider]
  const preferred = [
    ...new Set([
      ...(input.accountKind === undefined ? [] : (KIND_PROVIDERS[input.accountKind] ?? [])),
      ...(alias === undefined ? [] : [alias]),
      route.provider,
    ]),
  ]
  for (const provider of preferred) {
    const found = findInProvider(cache, provider, route.model)
    const price = found === undefined ? undefined : cache.providers[provider]?.[found.model]
    if (found !== undefined && price !== undefined) {
      return quoteFrom({ route, match: found.exact ? 'exact' : 'fuzzy', modelsDevId: `${provider}/${found.model}`, price })
    }
  }
  const index = indexCatalog(cache)
  for (const candidate of modelCandidates(route.model)) {
    const hit = index.byNormalizedId.get(normalizeModelId(candidate))
    const price = hit === undefined ? undefined : cache.providers[hit.provider]?.[hit.model]
    if (hit !== undefined && price !== undefined) return quoteFrom({ route, match: 'fuzzy', modelsDevId: `${hit.provider}/${hit.model}`, price })
  }
  return none
}

export class PricingCatalogModel {
  static readonly trimModelsDev = trimModelsDev
  static readonly parsePricingOverride = parsePricingOverride
  static readonly resolveRouteQuote = resolveRouteQuote
}

export interface PricingStatus {
  readonly fetchedAt: number | null
  readonly source: string
  readonly modelCount: number
  readonly refreshing: boolean
  readonly lastError: string | null
}

export interface PricingCatalog {
  readonly load: () => Promise<void>
  readonly refresh: () => Promise<PricingStatus>
  /** Refresh in the background when the cache is older than `maxAgeMs`; never throws. */
  readonly ensureFresh: (maxAgeMs: number) => Promise<void>
  readonly status: () => PricingStatus
  readonly current: () => PricingCache | null
}

export const createPricingCatalog = (options: {
  readonly path: string
  readonly fetch?: typeof fetch
  readonly now?: () => number
  readonly url?: string
}): PricingCatalog => {
  const now = options.now ?? Date.now
  const fetchImpl = options.fetch ?? fetch
  let cache: PricingCache | null = null
  let lastError: string | null = null
  let inFlight: Promise<PricingStatus> | null = null

  const status = (): PricingStatus => ({
    fetchedAt: cache?.fetchedAt ?? null,
    source: cache?.source ?? options.url ?? MODELS_DEV_URL,
    modelCount: cache === null ? 0 : Object.values(cache.providers).reduce((sum, models) => sum + Object.keys(models).length, 0),
    refreshing: inFlight !== null,
    lastError,
  })

  const load = async (): Promise<void> => {
    try {
      const parsed = pricingCacheSchema.safeParse(JSON.parse(await readFile(options.path, 'utf8')))
      if (parsed.success && (cache === null || parsed.data.fetchedAt > cache.fetchedAt)) cache = parsed.data
    } catch {
      // No cache yet, or an unreadable one: the next refresh writes a fresh file.
    }
  }

  const fetchAndStore = async (): Promise<void> => {
    try {
      const response = await fetchImpl(options.url ?? MODELS_DEV_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`models.dev answered ${String(response.status)}`)
      const next = PricingCatalogModel.trimModelsDev(await response.json(), now())
      if (Object.keys(next.providers).length === 0) throw new Error('models.dev returned no priced models')
      await mkdir(dirname(options.path), { recursive: true })
      const temporary = `${options.path}.${String(process.pid)}.tmp`
      await writeFile(temporary, JSON.stringify(next), 'utf8')
      await rename(temporary, options.path)
      cache = next
      lastError = null
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const refresh = (): Promise<PricingStatus> => {
    if (inFlight !== null) return inFlight
    const running = fetchAndStore()
      .finally(() => {
        inFlight = null
      })
      .then(status)
    inFlight = running
    return running
  }

  const ensureFresh = async (maxAgeMs: number): Promise<void> => {
    if (cache !== null && now() - cache.fetchedAt < maxAgeMs) return
    await refresh()
  }

  return { load, refresh, ensureFresh, status, current: () => cache }
}
