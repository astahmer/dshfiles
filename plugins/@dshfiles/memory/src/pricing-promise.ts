import { costOfTokens } from '@dshfiles/ai-accounts/cost-estimate'
import { createPricingCatalog, DEFAULT_PRICING_PATH, resolveRouteQuote } from '@dshfiles/ai-accounts/pricing-catalog'
import { Context, Effect, Layer } from 'effect'

/** List-price dollars of memory's own digest calls, from AI Accounts' models.dev cache. */
export class DigestPricing extends Context.Service<
  DigestPricing,
  {
    /** Dollars for one route's tokens, or null when the route is unpriced. */
    readonly usd: (line: {
      readonly provider: string
      readonly model: string
      readonly input: number
      readonly cacheRead: number
      readonly output: number
    }) => Effect.Effect<number | null>
  }
>()('@dshfiles/memory/DigestPricing') {
  static readonly layer = Layer.effect(
    DigestPricing,
    Effect.gen(function* () {
      const pricing = createPricingCatalog({ path: DEFAULT_PRICING_PATH })
      // The cache file is read once per activation; an unreadable one leaves every route unpriced.
      const loaded = yield* Effect.cached(
        Effect.tryPromise(() => pricing.load()).pipe(
          Effect.catchCause(cause => Effect.logDebug('memory: the pricing cache could not be read', cause)),
          Effect.withSpan('memory pricing load'),
        ),
      )
      return DigestPricing.of({
        usd: line =>
          Effect.map(loaded, () => {
            const price = resolveRouteQuote({ route: { provider: line.provider, model: line.model }, cache: pricing.current(), overrides: {} }).price
            if (price === null) return null
            return costOfTokens({
              tokens: { uncachedInputTokens: line.input, cacheReadTokens: line.cacheRead, outputTokens: line.output, cacheWriteTokens: 0 },
              price,
              band: 0,
            }).total
          }),
      })
    }),
  )
}
