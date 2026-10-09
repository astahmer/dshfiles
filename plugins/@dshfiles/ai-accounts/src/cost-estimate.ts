import { z } from 'zod'

/**
 * Session cost estimates, shared by the Host fold and the composer readout.
 *
 * Prices are USD per million tokens, the unit models.dev publishes. Context
 * tiers are priced per request: the Host fold buckets every request into the
 * widest {@link CONTEXT_BANDS} entry its prompt exceeds, so a tier at one of
 * those sizes prices exactly and the session total never re-reads the log.
 */

const TOKENS_PER_RATE_UNIT = 1_000_000

/** The Host projection key the composer readout subscribes to. */
export const SESSION_COST_PROJECTION_KEY = 'aiAccountsCost'

/** Every context-tier size models.dev publishes, normalized to "prompt exceeds N". */
export const CONTEXT_BANDS = [0, 32_000, 100_000, 128_000, 200_000, 256_000, 262_144, 272_000, 512_000, 524_288, 1_000_000] as const

export const contextBand = (contextTokens: number): number => {
  let band = 0
  for (const candidate of CONTEXT_BANDS) if (contextTokens > candidate) band = candidate
  return band
}

const rateShape = {
  input: z.number().min(0),
  output: z.number().min(0),
  cacheRead: z.number().min(0).optional(),
  cacheWrite: z.number().min(0).optional(),
}

export const modelPriceSchema = z.object({
  ...rateShape,
  /** Rates that replace the base ones once the request prompt exceeds `above` tokens. */
  tiers: z
    .array(z.object({ above: z.number().int().min(0), ...rateShape }))
    .max(8)
    .optional(),
})

export type ModelPrice = z.infer<typeof modelPriceSchema>
type ModelRates = Omit<ModelPrice, 'tiers'>

export const tokenBucketsSchema = z.object({
  uncachedInputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
})

export type TokenBuckets = z.infer<typeof tokenBucketsSchema>

export const costGroupSchema = z.object({
  provider: z.string().max(128),
  model: z.string().max(200),
  band: z.number().int().min(0),
  requests: z.number().int().min(0),
  tokens: tokenBucketsSchema,
})

export type CostGroup = z.infer<typeof costGroupSchema>

/** What the Host projection publishes for one session: every route's tokens, and the latest turn's. */
export const sessionCostViewSchema = z.object({
  groups: z.array(costGroupSchema).max(512),
  turn: z.object({ turn: z.number().int().min(0), groups: z.array(costGroupSchema).max(512) }).nullable(),
})

export type SessionCostView = z.infer<typeof sessionCostViewSchema>

export const routeQuoteSchema = z.object({
  provider: z.string().max(128),
  model: z.string().max(200),
  /** `provider/model` on models.dev, or null for an explicit override price. */
  modelsDevId: z.string().max(330).nullable(),
  match: z.enum(['override', 'exact', 'fuzzy', 'none']),
  free: z.boolean(),
  price: modelPriceSchema.nullable(),
})

export type RouteQuote = z.infer<typeof routeQuoteSchema>

export const routeKey = (route: { readonly provider: string; readonly model: string }): string => `${route.provider}/${route.model}`

export const isFreePrice = (price: ModelPrice): boolean =>
  price.input === 0 &&
  price.output === 0 &&
  (price.cacheRead ?? 0) === 0 &&
  (price.cacheWrite ?? 0) === 0 &&
  (price.tiers ?? []).every(tier => tier.input === 0 && tier.output === 0)

const ratesForBand = (price: ModelPrice, band: number): ModelRates => {
  let rates: ModelRates = price
  let reached = -1
  for (const tier of price.tiers ?? []) {
    if (tier.above <= band && tier.above > reached) {
      rates = tier
      reached = tier.above
    }
  }
  return rates
}

export interface CostBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly total: number
}

const ZERO_COST: CostBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }

/**
 * Cost of one bucket of tokens. A missing cache rate bills those tokens as
 * plain input: models.dev omits it for providers that do not discount or
 * surcharge cache traffic.
 */
export const costOfTokens = (input: { readonly tokens: TokenBuckets; readonly price: ModelPrice; readonly band: number }): CostBreakdown => {
  const rates = ratesForBand(input.price, input.band)
  const perUnit = (tokens: number, rate: number): number => (tokens * rate) / TOKENS_PER_RATE_UNIT
  const inputCost = perUnit(input.tokens.uncachedInputTokens, rates.input)
  const outputCost = perUnit(input.tokens.outputTokens, rates.output)
  const cacheReadCost = perUnit(input.tokens.cacheReadTokens, rates.cacheRead ?? rates.input)
  const cacheWriteCost = perUnit(input.tokens.cacheWriteTokens, rates.cacheWrite ?? rates.input)
  return {
    input: inputCost,
    output: outputCost,
    cacheRead: cacheReadCost,
    cacheWrite: cacheWriteCost,
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  }
}

const addCost = (left: CostBreakdown, right: CostBreakdown): CostBreakdown => ({
  input: left.input + right.input,
  output: left.output + right.output,
  cacheRead: left.cacheRead + right.cacheRead,
  cacheWrite: left.cacheWrite + right.cacheWrite,
  total: left.total + right.total,
})

export interface RouteCost {
  readonly provider: string
  readonly model: string
  readonly modelsDevId: string | null
  readonly match: RouteQuote['match']
  readonly requests: number
  readonly tokens: TokenBuckets
  readonly cost: CostBreakdown | null
  readonly free: boolean
}

export interface CostEstimate {
  readonly cost: CostBreakdown
  readonly tokens: TokenBuckets
  /** Some usage came from a route with no known price, so the total is a lower bound. */
  readonly partial: boolean
  /** At least one route had a non-free price. */
  readonly priced: boolean
  readonly routes: readonly RouteCost[]
}

const ZERO_TOKENS: TokenBuckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const addTokens = (left: TokenBuckets, right: TokenBuckets): TokenBuckets => ({
  uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
})

/** Price every group with its route's quote; groups of one route are merged for the breakdown. */
export const estimateCost = (input: { readonly groups: readonly CostGroup[]; readonly quotes: ReadonlyMap<string, RouteQuote> }): CostEstimate => {
  const routes = new Map<string, RouteCost>()
  let cost = ZERO_COST
  let tokens = ZERO_TOKENS
  let partial = false
  let priced = false
  for (const group of input.groups) {
    const key = routeKey(group)
    const quote = input.quotes.get(key)
    const groupCost = quote === undefined || quote.price === null ? null : costOfTokens({ tokens: group.tokens, price: quote.price, band: group.band })
    const free = quote?.free === true
    if (groupCost === null) partial = true
    else cost = addCost(cost, groupCost)
    if (groupCost !== null && !free) priced = true
    tokens = addTokens(tokens, group.tokens)
    const previous = routes.get(key)
    routes.set(key, {
      provider: group.provider,
      model: group.model,
      modelsDevId: quote?.modelsDevId ?? null,
      match: quote?.match ?? 'none',
      requests: (previous?.requests ?? 0) + group.requests,
      tokens: addTokens(previous?.tokens ?? ZERO_TOKENS, group.tokens),
      cost: groupCost === null ? (previous?.cost ?? null) : addCost(previous?.cost ?? ZERO_COST, groupCost),
      free,
    })
  }
  return { cost, tokens, partial, priced, routes: [...routes.values()] }
}

/** `$0.42`, `$0.0031` below a cent, `<$0.0001` for a session that has barely started. */
export const formatUsd = (amount: number): string => {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00'
  if (amount < 0.0001) return '<$0.0001'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 100) return `$${amount.toFixed(2)}`
  return `$${Math.round(amount).toLocaleString('en-US')}`
}
