import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'

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

const nonNegative = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const nonNegativeInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const rateShape = {
  input: nonNegative,
  output: nonNegative,
  cacheRead: Schema.optional(nonNegative),
  cacheWrite: Schema.optional(nonNegative),
}

export const modelPriceSchema = Schema.Struct({
  ...rateShape,
  /** Rates that replace the base ones once the request prompt exceeds `above` tokens. */
  tiers: Schema.optional(AiAccountsSchema.list(Schema.Struct({ above: nonNegativeInt, ...rateShape }), 8)),
})

export type ModelPrice = typeof modelPriceSchema.Type
type ModelRates = Omit<ModelPrice, 'tiers'>

export const tokenBucketsSchema = Schema.Struct({
  uncachedInputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  cacheReadTokens: nonNegativeInt,
  cacheWriteTokens: nonNegativeInt,
})

export type TokenBuckets = typeof tokenBucketsSchema.Type

export const costGroupSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMaxLength(128)),
  model: Schema.String.check(Schema.isMaxLength(200)),
  band: nonNegativeInt,
  requests: nonNegativeInt,
  tokens: tokenBucketsSchema,
})

export type CostGroup = typeof costGroupSchema.Type

/** What the Host projection publishes for one session: every route's tokens, and the latest turn's. */
const turnCostGroupsSchema = Schema.Struct({ turn: nonNegativeInt, groups: AiAccountsSchema.list(costGroupSchema, 512) })

export const sessionCostViewSchema = Schema.Struct({
  groups: AiAccountsSchema.list(costGroupSchema, 512),
  turn: Schema.NullOr(turnCostGroupsSchema),
  turns: Schema.optional(AiAccountsSchema.list(turnCostGroupsSchema, 512)),
})

export type SessionCostView = typeof sessionCostViewSchema.Type

export const routeQuoteSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMaxLength(128)),
  model: Schema.String.check(Schema.isMaxLength(200)),
  /** `provider/model` on models.dev, or null for an explicit override price. */
  modelsDevId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(330))),
  match: Schema.Literals(['override', 'exact', 'fuzzy', 'none']),
  free: Schema.Boolean,
  price: Schema.NullOr(modelPriceSchema),
})

export type RouteQuote = typeof routeQuoteSchema.Type

export interface CostBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly total: number
}

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

const ZERO_COST: CostBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
const ZERO_TOKENS: TokenBuckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

export class CostEstimateModel {
  static contextBand = (contextTokens: number): number => {
    let band = 0
    for (const candidate of CONTEXT_BANDS) if (contextTokens > candidate) band = candidate
    return band
  }

  static routeKey = (route: { readonly provider: string; readonly model: string }): string => `${route.provider}/${route.model}`

  static isFreePrice = (price: ModelPrice): boolean =>
    price.input === 0 &&
    price.output === 0 &&
    (price.cacheRead ?? 0) === 0 &&
    (price.cacheWrite ?? 0) === 0 &&
    (price.tiers ?? []).every(tier => tier.input === 0 && tier.output === 0)

  private static ratesForBand = (price: ModelPrice, band: number): ModelRates => {
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

  /**
   * Cost of one bucket of tokens. A missing cache rate bills those tokens as
   * plain input: models.dev omits it for providers that do not discount or
   * surcharge cache traffic.
   */
  static costOfTokens = (input: { readonly tokens: TokenBuckets; readonly price: ModelPrice; readonly band: number }): CostBreakdown => {
    const rates = CostEstimateModel.ratesForBand(input.price, input.band)
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

  private static addCost = (left: CostBreakdown, right: CostBreakdown): CostBreakdown => ({
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    total: left.total + right.total,
  })

  private static addTokens = (left: TokenBuckets, right: TokenBuckets): TokenBuckets => ({
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  })

  /** Price every group with its route's quote; groups of one route are merged for the breakdown. */
  static estimateCost = (input: { readonly groups: readonly CostGroup[]; readonly quotes: ReadonlyMap<string, RouteQuote> }): CostEstimate => {
    const routes = new Map<string, RouteCost>()
    let cost = ZERO_COST
    let tokens = ZERO_TOKENS
    let partial = false
    let priced = false
    for (const group of input.groups) {
      const key = CostEstimateModel.routeKey(group)
      const quote = input.quotes.get(key)
      const groupCost =
        quote === undefined || quote.price === null ? null : CostEstimateModel.costOfTokens({ tokens: group.tokens, price: quote.price, band: group.band })
      const free = quote?.free === true
      if (groupCost === null) partial = true
      else cost = CostEstimateModel.addCost(cost, groupCost)
      if (groupCost !== null && !free) priced = true
      tokens = CostEstimateModel.addTokens(tokens, group.tokens)
      const previous = routes.get(key)
      routes.set(key, {
        provider: group.provider,
        model: group.model,
        modelsDevId: quote?.modelsDevId ?? null,
        match: quote?.match ?? 'none',
        requests: (previous?.requests ?? 0) + group.requests,
        tokens: CostEstimateModel.addTokens(previous?.tokens ?? ZERO_TOKENS, group.tokens),
        cost: groupCost === null ? (previous?.cost ?? null) : CostEstimateModel.addCost(previous?.cost ?? ZERO_COST, groupCost),
        free,
      })
    }
    return { cost, tokens, partial, priced, routes: [...routes.values()] }
  }

  /** Format a list-price estimate, marking it as approximate or a lower bound. */
  static formatEstimate = (estimate: CostEstimate): string => `${estimate.partial ? '≥' : '≈'}${CostEstimateModel.formatUsd(estimate.cost.total)}`

  /** `$0.42`, `$0.0031` below a cent, `<$0.0001` for a session that has barely started. */
  static formatUsd = (amount: number): string => {
    if (!Number.isFinite(amount) || amount <= 0) return '$0.00'
    if (amount < 0.0001) return '<$0.0001'
    if (amount < 0.01) return `$${amount.toFixed(4)}`
    if (amount < 100) return `$${amount.toFixed(2)}`
    return `$${Math.round(amount).toLocaleString('en-US')}`
  }
}

/** Free-function surface the memory plugin imports; the lane grouped it under the model. */
export const costOfTokens = CostEstimateModel.costOfTokens
