import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { CostEstimateModel } from '@dshfiles/ai-accounts/cost-estimate'
import { PricingCatalogModel, type PricingCache } from '@dshfiles/ai-accounts/pricing-catalog'

/** Span attributes carrying a model call's list-price estimate; the turn span repeats the sum of its calls. */
export const CostAttributes = {
  usd: 'dshx.cost.usd',
  /** The models.dev `provider/model` the price came from, so a fuzzy match is visible on the span. */
  priceId: 'dshx.cost.price_id',
} as const

export interface CallPrice {
  readonly usd: number
  readonly priceId: string | null
}

export interface PricedCall {
  readonly provider: string
  readonly model: string
  readonly usage: TokenUsage
}

export type PriceCall = (call: PricedCall) => CallPrice | undefined

type RouteQuote = ReturnType<typeof PricingCatalogModel.resolveRouteQuote>

/**
 * Prices one model call from AI Accounts' models.dev cache, the same catalog and route resolution the usage ledger
 * and memory digests use, so a span's cost matches the Usage panel's request row. Quotes are memoized per catalog
 * load; a call whose route has no price is left unpriced rather than priced at zero.
 */
export const createCallPricer = (options: {
  readonly catalog: () => PricingCache | null
  readonly accountKind: (provider: string) => string | undefined
}): PriceCall => {
  let quotedFrom: PricingCache | null = null
  const quotes = new Map<string, RouteQuote>()
  return call => {
    const cache = options.catalog()
    if (cache === null) return undefined
    if (cache !== quotedFrom) {
      quotes.clear()
      quotedFrom = cache
    }
    const accountKind = options.accountKind(call.provider)
    const key = `${accountKind ?? ''}\u0000${CostEstimateModel.routeKey(call)}`
    const quote =
      quotes.get(key) ??
      PricingCatalogModel.resolveRouteQuote({
        route: { provider: call.provider, model: call.model },
        cache,
        accountKind,
        overrides: {},
      })
    quotes.set(key, quote)
    if (quote.price === null) return undefined
    const tokens = {
      uncachedInputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      cacheReadTokens: call.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: call.usage.cacheWriteTokens ?? 0,
    }
    const band = CostEstimateModel.contextBand(tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens)
    return { usd: CostEstimateModel.costOfTokens({ tokens, price: quote.price, band }).total, priceId: quote.modelsDevId }
  }
}
